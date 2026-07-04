"""
Motor de conversión a Markdown, optimizado para 512 MB de RAM (Render free).

Estrategia por tipo de archivo:
  - PDF: ruta rápida con PyMuPDF, SIN pasar por markitdown.
      * Si tiene texto nativo -> se extrae directamente (ligero y rápido).
      * Si está escaneado    -> pipeline PyMuPDF (render a imagen) + OCR
        con pytesseract, con preprocesado de imagen.
    Esto evita que markitdown inicialice sus detectores basados en ONNX
    (magika/onnxruntime) para PDFs, que era la causa del crash por OOM.
  - Office (docx/xlsx/pptx) y texto: `markitdown`, instanciado de forma
    PEREZOSA (solo la primera vez que se necesita) y en modo mínimo:
    sin plugins, sin cliente LLM y sin Document Intelligence, para no
    cargar modelos pesados en memoria al arrancar el servicio.
  - Imágenes: OCR con pytesseract (cuando el cliente no aporta API keys).

Preprocesado de OCR: escala de grises + autocontraste + binarización con
umbral de Otsu (solo PIL, sin OpenCV). Nada se escribe jamás en disco.
"""

import io
import logging
import threading

from .security import IMAGE_EXTENSIONS

logger = logging.getLogger("convertidor.converter")


class ConversionError(Exception):
    """Error de conversión con mensaje apto para el cliente."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# --- Parámetros de la ruta PDF y del OCR -------------------------------------

# Umbral mínimo de caracteres para considerar que un PDF tiene texto nativo
# (los escaneados suelen devolver cadenas vacías o restos de 1-2 caracteres).
_MIN_NATIVE_TEXT_CHARS = 25

# Resolución de renderizado de página. 200 DPI equilibra precisión de OCR
# y consumo de RAM.
_OCR_RENDER_DPI = 200

# Máximo de páginas a procesar por OCR: evita agotar memoria/CPU del plan
# gratuito con PDFs largos.
_MAX_OCR_PAGES = 20

# Aviso estándar cuando no se puede extraer texto de un PDF escaneado.
_SCANNED_PDF_HINT = (
    "Sugerencia: configura una API key de LLM en el panel de ajustes "
    "para transcribirlo con visión artificial."
)

# Mapeo de extensión -> mimetype para ayudar a markitdown con el stream.
_MIME_BY_EXTENSION = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".json": "application/json",
    ".html": "text/html",
    ".htm": "text/html",
    ".xml": "text/xml",
}


# ---------------------------------------------------------------------------
# markitdown: instancia perezosa y mínima (ahorro de RAM en el arranque)
# ---------------------------------------------------------------------------

_markitdown_instance = None
_markitdown_lock = threading.Lock()


def _get_markitdown():
    """
    Devuelve la instancia única de MarkItDown, creándola solo la primera
    vez que se necesita (lazy singleton, seguro entre hilos).

    Configuración mínima deliberada:
      - enable_plugins=False  -> sin conversores de terceros.
      - llm_client=None       -> sin cliente LLM (no describe imágenes,
                                 no carga nada relacionado con modelos).
      - sin docintel_endpoint -> sin Azure Document Intelligence.

    Al ser perezosa, los peores costes de importación (magika/onnxruntime,
    usados por markitdown para detectar tipos de archivo) no se pagan al
    arrancar el servicio ni al procesar PDFs o imágenes, solo si llega a
    entrar un documento de Office/texto.
    """
    global _markitdown_instance
    if _markitdown_instance is None:
        with _markitdown_lock:
            if _markitdown_instance is None:
                from markitdown import MarkItDown

                logger.info("Inicializando MarkItDown (modo mínimo, sin LLM)")
                _markitdown_instance = MarkItDown(
                    enable_plugins=False,
                    llm_client=None,
                )
    return _markitdown_instance


def convert_to_markdown(data: bytes, extension: str, filename: str) -> dict:
    """
    Punto de entrada del motor de conversión.

    Devuelve un dict con:
      - markdown: el contenido convertido.
      - engine:   motor utilizado ("pymupdf", "markitdown", "ocr-tesseract"
                  u "ocr-tesseract-pdf").
      - warning:  aviso opcional (p. ej. PDF escaneado sin texto).
    """
    if extension == ".pdf":
        # Ruta rápida: los PDFs NUNCA pasan por markitdown (evita ONNX/OOM).
        return _convert_pdf(data, filename)
    if extension in IMAGE_EXTENSIONS:
        return _convert_image_with_ocr(data)
    return _convert_document_with_markitdown(data, extension, filename)


# ---------------------------------------------------------------------------
# Ruta PDF: extractor ligero PyMuPDF -> fallback OCR (sin markitdown)
# ---------------------------------------------------------------------------

def _convert_pdf(data: bytes, filename: str) -> dict:
    """
    Convierte un PDF priorizando el extractor ligero:

      1. PyMuPDF extrae el texto nativo página a página (coste en RAM
         mínimo). Si hay texto suficiente, se devuelve inmediatamente.
      2. Si no hay texto (PDF escaneado), se salta directamente al pipeline
         de OCR (render de página + Tesseract), sin tocar markitdown.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:
        raise ConversionError(
            "El servidor no tiene soporte de PDF instalado.", status_code=503
        ) from exc

    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        logger.exception("PyMuPDF no pudo abrir '%s'", filename)
        raise ConversionError(
            "No se pudo abrir el PDF. Puede estar corrupto o protegido "
            "con contraseña.",
            status_code=422,
        ) from exc

    # --- 1. Intento ligero: texto nativo ---
    try:
        if document.needs_pass:
            raise ConversionError(
                "El PDF está protegido con contraseña.", status_code=422
            )

        page_texts = [page.get_text("text").strip() for page in document]
    except ConversionError:
        document.close()
        raise
    except Exception:
        logger.exception("Fallo extrayendo texto nativo de '%s'", filename)
        page_texts = []
    finally:
        # El documento se conserva abierto solo si hará falta para el OCR;
        # como _ocr_scanned_pdf reabre desde bytes, se cierra siempre aquí.
        document.close()

    native_text = "\n\n".join(t for t in page_texts if t).strip()
    if len(native_text) >= _MIN_NATIVE_TEXT_CHARS:
        return {"markdown": native_text, "engine": "pymupdf", "warning": None}

    # --- 2. PDF escaneado: directo al pipeline de OCR ---
    logger.info("PDF sin texto nativo: aplicando OCR ('%s')", filename)
    ocr_result = _ocr_scanned_pdf(data)
    if ocr_result is not None:
        return ocr_result

    return {
        "markdown": native_text,
        "engine": "pymupdf",
        "warning": (
            "El PDF no contiene texto extraíble (posiblemente escaneado) y "
            f"el OCR no pudo recuperar contenido. {_SCANNED_PDF_HINT}"
        ),
    }


def _ocr_scanned_pdf(data: bytes) -> dict | None:
    """
    Renderiza las páginas del PDF a imágenes en memoria y les aplica OCR.

    Devuelve un dict de resultado si el OCR recuperó texto, o None si el
    fallback no está disponible o no encontró nada (el llamador conserva
    entonces el aviso de "PDF escaneado").
    """
    try:
        import fitz  # PyMuPDF: renderizado de PDF 100% en memoria
        import pytesseract
        from PIL import Image
    except ImportError:
        logger.warning("Fallback OCR no disponible: faltan dependencias.")
        return None

    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception:
        logger.exception("PyMuPDF no pudo abrir el PDF para el fallback OCR")
        return None

    total_pages = document.page_count
    pages_to_process = min(total_pages, _MAX_OCR_PAGES)
    page_texts: list[str] = []

    try:
        for page_number in range(pages_to_process):
            # Renderizado directo en escala de grises (menos RAM que RGB).
            pixmap = document[page_number].get_pixmap(
                dpi=_OCR_RENDER_DPI, colorspace=fitz.csGRAY
            )
            image = Image.frombytes(
                "L", (pixmap.width, pixmap.height), pixmap.samples
            )
            # Liberar el pixmap cuanto antes: cada página se procesa y se
            # descarta antes de renderizar la siguiente (RAM acotada).
            del pixmap
            try:
                text = _run_tesseract(_preprocess_for_ocr(image))
            finally:
                image.close()

            if text:
                # Encabezado de página solo si el PDF tiene varias.
                if pages_to_process > 1:
                    page_texts.append(f"## Página {page_number + 1}\n\n{text}")
                else:
                    page_texts.append(text)
    except pytesseract.TesseractNotFoundError:
        logger.error("Binario tesseract-ocr no encontrado: fallback OCR omitido.")
        return None
    except Exception:
        logger.exception("Fallo inesperado durante el fallback OCR del PDF")
        return None
    finally:
        document.close()

    if not page_texts:
        return None

    warning = None
    if total_pages > pages_to_process:
        warning = (
            f"El PDF tiene {total_pages} páginas; por límites del plan "
            f"gratuito solo se aplicó OCR a las primeras {pages_to_process}."
        )

    return {
        "markdown": "\n\n---\n\n".join(page_texts),
        "engine": "ocr-tesseract-pdf",
        "warning": warning,
    }


# ---------------------------------------------------------------------------
# Office y texto plano: markitdown (perezoso, modo mínimo)
# ---------------------------------------------------------------------------

def _convert_document_with_markitdown(
    data: bytes, extension: str, filename: str
) -> dict:
    """Convierte documentos de Office/texto en memoria usando markitdown."""
    from markitdown import StreamInfo

    stream = io.BytesIO(data)
    stream_info = StreamInfo(
        extension=extension,
        mimetype=_MIME_BY_EXTENSION.get(extension),
        filename=filename,
    )

    try:
        result = _get_markitdown().convert_stream(stream, stream_info=stream_info)
    except Exception as exc:  # markitdown lanza excepciones heterogéneas
        logger.exception("Fallo de markitdown al convertir '%s'", filename)
        raise ConversionError(
            "No se pudo convertir el documento. Puede estar corrupto, "
            "protegido con contraseña o en un formato no compatible.",
            status_code=422,
        ) from exc

    markdown = (result.markdown or "").strip()
    return {"markdown": markdown, "engine": "markitdown", "warning": None}


# ---------------------------------------------------------------------------
# OCR de imágenes sueltas
# ---------------------------------------------------------------------------

def _convert_image_with_ocr(data: bytes) -> dict:
    """
    OCR gratuito para imágenes con pytesseract, totalmente en memoria.

    Se usa cuando el cliente no ha configurado API keys de LLM.
    """
    try:
        from PIL import Image
        import pytesseract
    except ImportError as exc:
        raise ConversionError(
            "El servidor no tiene soporte de OCR instalado.", status_code=503
        ) from exc

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        raise ConversionError(
            "No se pudo abrir la imagen. Puede estar corrupta.",
            status_code=422,
        ) from exc

    try:
        text = _run_tesseract(_preprocess_for_ocr(image))
    except pytesseract.TesseractNotFoundError as exc:
        logger.error("Binario tesseract-ocr no encontrado en el sistema.")
        raise ConversionError(
            "El motor OCR no está disponible en el servidor.", status_code=503
        ) from exc
    except Exception as exc:
        logger.exception("Fallo de pytesseract durante el OCR")
        raise ConversionError(
            "Error al ejecutar el OCR sobre la imagen.", status_code=500
        ) from exc
    finally:
        image.close()

    warning = None
    if not text:
        warning = (
            "El OCR no detectó texto en la imagen. Para mejores resultados "
            "con imágenes complejas, configura una API key de LLM."
        )

    return {"markdown": text, "engine": "ocr-tesseract", "warning": warning}


# ---------------------------------------------------------------------------
# Preprocesado de imágenes para Tesseract (PIL, sin OpenCV)
# ---------------------------------------------------------------------------

def _preprocess_for_ocr(image):
    """
    Mejora la precisión del OCR aplicando, en este orden:
      1. Escala de grises (elimina ruido de color).
      2. Autocontraste (estira el histograma: mejora escaneos apagados).
      3. Binarización con umbral de Otsu (separa texto del fondo).

    Se implementa solo con PIL para no añadir OpenCV (~60 MB) al contenedor.
    """
    from PIL import ImageOps

    # 1. Escala de grises. Las imágenes con canal alfa se aplanan sobre
    #    fondo blanco para no convertir la transparencia en negro.
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        from PIL import Image as PILImage

        background = PILImage.new("RGBA", image.size, (255, 255, 255, 255))
        background.alpha_composite(image)
        image = background
    grayscale = ImageOps.grayscale(image)

    # 2. Autocontraste: descarta el 1% de píxeles extremos (motas/ruido).
    contrasted = ImageOps.autocontrast(grayscale, cutoff=1)

    # 3. Umbral de Otsu sobre el histograma + binarización.
    threshold = _otsu_threshold(contrasted.histogram())
    binarized = contrasted.point(lambda p: 255 if p > threshold else 0)

    return binarized


def _otsu_threshold(histogram: list[int]) -> int:
    """
    Calcula el umbral óptimo de binarización con el método de Otsu:
    maximiza la varianza entre las clases "texto" y "fondo" del histograma.
    Implementación pura en Python (256 niveles), sin numpy ni OpenCV.
    """
    total_pixels = sum(histogram)
    if total_pixels == 0:
        return 127  # imagen degenerada: umbral medio

    total_sum = sum(level * count for level, count in enumerate(histogram))

    sum_background = 0.0
    weight_background = 0
    best_threshold = 127
    max_between_variance = -1.0

    for level in range(256):
        weight_background += histogram[level]
        if weight_background == 0:
            continue
        weight_foreground = total_pixels - weight_background
        if weight_foreground == 0:
            break

        sum_background += level * histogram[level]
        mean_background = sum_background / weight_background
        mean_foreground = (total_sum - sum_background) / weight_foreground

        between_variance = (
            weight_background
            * weight_foreground
            * (mean_background - mean_foreground) ** 2
        )
        if between_variance > max_between_variance:
            max_between_variance = between_variance
            best_threshold = level

    return best_threshold


def _run_tesseract(image) -> str:
    """Ejecuta Tesseract (español + inglés) y devuelve el texto limpio."""
    import pytesseract

    # --psm 3: segmentación automática de página (por defecto, robusta
    # tanto para documentos completos como para capturas).
    text = pytesseract.image_to_string(image, lang="spa+eng", config="--psm 3")
    return text.strip()
