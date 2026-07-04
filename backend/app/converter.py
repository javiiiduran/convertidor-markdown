"""
Motor de conversión a Markdown.

Estrategia:
  - Documentos (PDF con texto nativo, Office, texto plano): `markitdown`
    de Microsoft, procesando estrictamente en memoria (io.BytesIO).
  - Imágenes (cuando el cliente NO aporta API keys de LLM): OCR gratuito
    con `pytesseract` (requiere el binario `tesseract-ocr`, instalado vía
    Docker en Render).

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
      - engine:   motor utilizado ("markitdown" u "ocr-tesseract").
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
        # PDF sin capa de texto: probablemente escaneado.
        warning = (
            "El PDF no contiene texto extraíble (posiblemente escaneado). "
            "Sugerencia: configura una API key de LLM en el panel de ajustes "
            "para transcribirlo con visión artificial."
        )

    return {"markdown": markdown, "engine": "markitdown", "warning": warning}


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
        # Conversión a RGB para formatos con canal alfa o paletas.
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
    except Exception as exc:
        raise ConversionError(
            "No se pudo abrir la imagen. Puede estar corrupta.",
            status_code=422,
        ) from exc

    try:
        # spa+eng cubre español e inglés; ambos paquetes van en el Docker.
        text = pytesseract.image_to_string(image, lang="spa+eng")
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

    markdown = text.strip()
    warning = None
    if not markdown:
        warning = (
            "El OCR no detectó texto en la imagen. Para mejores resultados "
            "con imágenes complejas, configura una API key de LLM."
        )

    return {"markdown": markdown, "engine": "ocr-tesseract", "warning": warning}
