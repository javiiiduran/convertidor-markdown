"""
Motor de conversión a Markdown.

Estrategia:
  - Documentos (PDF con texto nativo, Office, texto plano): `markitdown`
    de Microsoft, procesando estrictamente en memoria (io.BytesIO).
  - PDF escaneado (markitdown devuelve texto vacío): fallback automático
    que renderiza cada página a imagen con PyMuPDF (en memoria, sin
    binarios externos ni archivos temporales) y aplica OCR con pytesseract.
  - Imágenes (cuando el cliente NO aporta API keys de LLM): OCR gratuito
    con `pytesseract` (requiere el binario `tesseract-ocr`, instalado vía
    Docker en Render).

Preprocesado de OCR: antes de pasar cualquier imagen por Tesseract se
aplica escala de grises + autocontraste + binarización con umbral de Otsu
(implementado con PIL, sin dependencia de OpenCV) para mejorar la precisión.

Nada se escribe jamás en el disco del servidor.
"""

import io
import logging

from markitdown import MarkItDown, StreamInfo

from .security import IMAGE_EXTENSIONS

logger = logging.getLogger("convertidor.converter")


class ConversionError(Exception):
    """Error de conversión con mensaje apto para el cliente."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# Instancia única y reutilizable de markitdown.
# enable_plugins=False reduce superficie de ataque (sin plugins de terceros).
_markitdown = MarkItDown(enable_plugins=False)

# --- Parámetros del fallback OCR para PDFs escaneados -----------------------

# Resolución de renderizado de página. 200 DPI equilibra precisión de OCR
# y consumo de RAM (el plan gratuito de Render tiene 512 MB).
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
    ".pdf": "application/pdf",
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


def convert_to_markdown(data: bytes, extension: str, filename: str) -> dict:
    """
    Punto de entrada del motor de conversión.

    Devuelve un dict con:
      - markdown: el contenido convertido.
      - engine:   motor utilizado ("markitdown", "ocr-tesseract" u
                  "ocr-tesseract-pdf" para el fallback de PDF escaneado).
      - warning:  aviso opcional (p. ej. PDF escaneado sin texto).
    """
    if extension in IMAGE_EXTENSIONS:
        return _convert_image_with_ocr(data)
    return _convert_document_with_markitdown(data, extension, filename)


def _convert_document_with_markitdown(
    data: bytes, extension: str, filename: str
) -> dict:
    """Convierte documentos en memoria usando markitdown."""
    stream = io.BytesIO(data)
    stream_info = StreamInfo(
        extension=extension,
        mimetype=_MIME_BY_EXTENSION.get(extension),
        filename=filename,
    )

    try:
        result = _markitdown.convert_stream(stream, stream_info=stream_info)
    except Exception as exc:  # markitdown lanza excepciones heterogéneas
        logger.exception("Fallo de markitdown al convertir '%s'", filename)
        raise ConversionError(
            "No se pudo convertir el documento. Puede estar corrupto, "
            "protegido con contraseña o en un formato no compatible.",
            status_code=422,
        ) from exc

    markdown = (result.markdown or "").strip()
    warning = None

    if not markdown and extension == ".pdf":
        # PDF sin capa de texto: probablemente escaneado. Antes de rendirnos,
        # se intenta el fallback de OCR página a página (PyMuPDF + Tesseract).
        logger.info("PDF sin texto nativo: intentando fallback OCR ('%s')", filename)
        ocr_result = _ocr_scanned_pdf(data)
        if ocr_result is not None:
            return ocr_result

        warning = (
            "El PDF no contiene texto extraíble (posiblemente escaneado) y "
            f"el OCR no pudo recuperar contenido. {_SCANNED_PDF_HINT}"
        )

    return {"markdown": markdown, "engine": "markitdown", "warning": warning}


# ---------------------------------------------------------------------------
# Fallback OCR para PDFs escaneados (PyMuPDF + pytesseract, en memoria)
# ---------------------------------------------------------------------------

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
