"""
Motor de conversión a Markdown, optimizado para el plan gratuito de Render
(512 MB de RAM y CPU compartida).

Estrategia por tipo de archivo:
  - PDF: extractor rápido de PyMuPDF, SIN pasar por markitdown.
      * Si tiene texto nativo -> se extrae directamente (ligero y rápido).
      * Si está escaneado    -> HTTP 422 con code="LLM_REQUIRED": el
        cliente debe procesarlo con visión artificial (API key de LLM).
  - Imágenes: NO se procesan en el servidor -> HTTP 422 con
    code="LLM_REQUIRED". (El OCR local con Tesseract se eliminó: la CPU
    del plan gratuito dejaba las peticiones colgadas indefinidamente.)
  - Office (docx/xlsx/pptx) y texto: `markitdown`, instanciado de forma
    PEREZOSA (solo la primera vez que se necesita) y en modo mínimo:
    sin plugins, sin cliente LLM y sin Document Intelligence, para no
    cargar modelos pesados (onnxruntime) en memoria al arrancar.

Nada se escribe jamás en el disco del servidor.
"""

import io
import logging
import threading

from .security import IMAGE_EXTENSIONS

logger = logging.getLogger("convertidor.converter")

# Código machine-readable que el frontend usa para detectar que el archivo
# necesita procesamiento con visión artificial (LLM del lado del cliente).
LLM_REQUIRED_CODE = "LLM_REQUIRED"


class ConversionError(Exception):
    """Error de conversión con mensaje apto para el cliente."""

    def __init__(self, message: str, status_code: int = 500, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


# --- Parámetros de la ruta PDF ------------------------------------------------

# Umbral mínimo de caracteres para considerar que un PDF tiene texto nativo
# (los escaneados suelen devolver cadenas vacías o restos de 1-2 caracteres).
_MIN_NATIVE_TEXT_CHARS = 25

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
      - llm_client=None       -> sin cliente LLM.
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
      - engine:   motor utilizado ("pymupdf" o "markitdown").
      - warning:  aviso opcional.

    Lanza ConversionError(422, code="LLM_REQUIRED") para imágenes y PDFs
    escaneados: esos archivos se procesan en el cliente con la API key
    de LLM del usuario, nunca en este servidor.
    """
    if extension == ".pdf":
        return _convert_pdf(data, filename)

    if extension in IMAGE_EXTENSIONS:
        # Sin OCR local: las imágenes requieren visión artificial del lado
        # del cliente. Respuesta inmediata, sin bloquear la CPU del servidor.
        raise ConversionError(
            "Las imágenes requieren una API key de LLM (visión artificial). "
            "Agrégala en el panel de ajustes del frontend.",
            status_code=422,
            code=LLM_REQUIRED_CODE,
        )

    return _convert_document_with_markitdown(data, extension, filename)


# ---------------------------------------------------------------------------
# Ruta PDF: solo el extractor rápido de PyMuPDF
# ---------------------------------------------------------------------------

def _convert_pdf(data: bytes, filename: str) -> dict:
    """
    Extrae el texto nativo del PDF con PyMuPDF (rápido y ligero).

    Si el PDF no tiene texto (está escaneado), responde inmediatamente con
    422 + code="LLM_REQUIRED" para que el cliente lo procese con su LLM.
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

    try:
        if document.needs_pass:
            raise ConversionError(
                "El PDF está protegido con contraseña.", status_code=422
            )
        page_texts = [page.get_text("text").strip() for page in document]
    except ConversionError:
        raise
    except Exception as exc:
        logger.exception("Fallo extrayendo texto nativo de '%s'", filename)
        raise ConversionError(
            "No se pudo extraer el texto del PDF.", status_code=422
        ) from exc
    finally:
        document.close()

    native_text = "\n\n".join(t for t in page_texts if t).strip()
    if len(native_text) >= _MIN_NATIVE_TEXT_CHARS:
        return {"markdown": native_text, "engine": "pymupdf", "warning": None}

    # PDF escaneado: el servidor no hace OCR. Respuesta inmediata para que
    # el cliente use visión artificial con su propia API key.
    raise ConversionError(
        "El PDF no contiene texto extraíble (posiblemente escaneado). "
        "Requiere procesamiento con visión artificial: configura una API "
        "key de LLM en el panel de ajustes.",
        status_code=422,
        code=LLM_REQUIRED_CODE,
    )


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
