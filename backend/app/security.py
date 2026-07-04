"""
Módulo de seguridad para la validación de archivos subidos.

Responsabilidades:
  1. Sanitizar nombres de archivo (prevención de Path Traversal).
  2. Validar la extensión contra una lista blanca estricta.
  3. Verificar los "Magic Numbers" (firmas de bytes) para asegurar que el
     contenido real del archivo coincide con la extensión declarada y no es
     un binario malicioso camuflado.

Todo el procesamiento posterior ocurre en memoria (io.BytesIO); este módulo
nunca escribe en disco.
"""

import re
import unicodedata

# ---------------------------------------------------------------------------
# Lista blanca de extensiones soportadas
# ---------------------------------------------------------------------------

# Extensiones de imagen (se procesan con OCR si no hay API key en el cliente).
IMAGE_EXTENSIONS: frozenset[str] = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
)

# Documentos binarios que procesa markitdown.
DOCUMENT_EXTENSIONS: frozenset[str] = frozenset(
    {".pdf", ".docx", ".xlsx", ".pptx"}
)

# Formatos de texto plano (no tienen firma de bytes; se validan aparte).
TEXT_EXTENSIONS: frozenset[str] = frozenset(
    {".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".html", ".htm", ".xml"}
)

ALLOWED_EXTENSIONS: frozenset[str] = (
    IMAGE_EXTENSIONS | DOCUMENT_EXTENSIONS | TEXT_EXTENSIONS
)

# ---------------------------------------------------------------------------
# Magic Numbers (firmas de bytes) por extensión
# ---------------------------------------------------------------------------

# Cada entrada es una lista de firmas aceptadas: (offset, bytes_esperados).
# El archivo es válido si TODAS las partes de al menos UNA firma coinciden.
_MAGIC_SIGNATURES: dict[str, list[list[tuple[int, bytes]]]] = {
    ".pdf":  [[(0, b"%PDF-")]],
    # Los formatos modernos de Office (OOXML) son contenedores ZIP.
    ".docx": [[(0, b"PK\x03\x04")]],
    ".xlsx": [[(0, b"PK\x03\x04")]],
    ".pptx": [[(0, b"PK\x03\x04")]],
    ".png":  [[(0, b"\x89PNG\r\n\x1a\n")]],
    ".jpg":  [[(0, b"\xff\xd8\xff")]],
    ".jpeg": [[(0, b"\xff\xd8\xff")]],
    # WEBP: "RIFF" en offset 0 y "WEBP" en offset 8.
    ".webp": [[(0, b"RIFF"), (8, b"WEBP")]],
    ".gif":  [[(0, b"GIF87a")], [(0, b"GIF89a")]],
    ".bmp":  [[(0, b"BM")]],
    ".tiff": [[(0, b"II*\x00")], [(0, b"MM\x00*")]],
    ".tif":  [[(0, b"II*\x00")], [(0, b"MM\x00*")]],
}


class FileValidationError(Exception):
    """Error de validación de archivo con mensaje apto para el cliente."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Sanitización de nombres de archivo (anti Path Traversal)
# ---------------------------------------------------------------------------

_SAFE_CHARS_RE = re.compile(r"[^A-Za-z0-9._\- ]")
_MULTI_DOT_RE = re.compile(r"\.{2,}")
_MAX_FILENAME_LENGTH = 120


def sanitize_filename(raw_name: str | None) -> str:
    """
    Sanitiza exhaustivamente un nombre de archivo recibido del cliente.

    Medidas aplicadas:
      - Normalización Unicode (evita homógrafos y caracteres compuestos).
      - Eliminación de rutas: se toma solo el último componente tras '/' y '\\'.
      - Eliminación de bytes nulos y caracteres de control.
      - Lista blanca de caracteres: alfanuméricos, punto, guion, guion bajo
        y espacio. Todo lo demás se sustituye por '_'.
      - Colapso de secuencias de puntos ('..') para bloquear traversal.
      - Sin puntos ni espacios al inicio/fin (evita archivos ocultos y trucos
        de extensión en Windows).
      - Longitud máxima acotada preservando la extensión.
    """
    if not raw_name:
        return "archivo"

    # Normalización Unicode y eliminación de bytes nulos / control.
    name = unicodedata.normalize("NFKC", raw_name)
    name = name.replace("\x00", "")
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")

    # Quedarse solo con el último componente de cualquier ruta.
    name = name.replace("\\", "/").split("/")[-1]

    # Lista blanca de caracteres y colapso de puntos consecutivos.
    name = _SAFE_CHARS_RE.sub("_", name)
    name = _MULTI_DOT_RE.sub(".", name)
    name = name.strip(". ")

    if not name:
        return "archivo"

    # Acotar longitud preservando la extensión.
    if len(name) > _MAX_FILENAME_LENGTH:
        stem, dot, ext = name.rpartition(".")
        if dot and len(ext) <= 10:
            keep = _MAX_FILENAME_LENGTH - len(ext) - 1
            name = f"{stem[:keep]}.{ext}"
        else:
            name = name[:_MAX_FILENAME_LENGTH]

    return name


def get_validated_extension(filename: str) -> str:
    """
    Extrae la extensión (en minúsculas) y la valida contra la lista blanca.

    Lanza FileValidationError (HTTP 415) si la extensión no está soportada.
    """
    _, dot, ext = filename.rpartition(".")
    extension = f".{ext.lower()}" if dot else ""

    if extension not in ALLOWED_EXTENSIONS:
        supported = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise FileValidationError(
            f"Tipo de archivo no soportado ('{extension or 'sin extensión'}'). "
            f"Formatos permitidos: {supported}",
            status_code=415,
        )
    return extension


# ---------------------------------------------------------------------------
# Validación de contenido (Magic Numbers)
# ---------------------------------------------------------------------------

def validate_magic_numbers(data: bytes, extension: str) -> None:
    """
    Verifica que los primeros bytes del archivo coinciden con la firma
    esperada para su extensión.

    - Binarios (PDF, Office, imágenes): firma exacta obligatoria.
    - Texto plano: no hay firma estándar; se comprueba que no contenga
      bytes nulos (indicador típico de binario camuflado) y que sea
      decodificable como texto.
    """
    if not data:
        raise FileValidationError("El archivo está vacío.", status_code=422)

    if extension in TEXT_EXTENSIONS:
        _validate_text_content(data)
        return

    signatures = _MAGIC_SIGNATURES.get(extension)
    if signatures is None:
        # Defensa en profundidad: nunca debería llegar aquí gracias a la
        # lista blanca de extensiones.
        raise FileValidationError("Tipo de archivo no soportado.", status_code=415)

    for signature in signatures:
        if all(
            data[offset : offset + len(expected)] == expected
            for offset, expected in signature
        ):
            return

    raise FileValidationError(
        "El contenido del archivo no coincide con su extensión. "
        "Posible archivo corrupto o camuflado; se rechaza por seguridad.",
        status_code=422,
    )


def _validate_text_content(data: bytes) -> None:
    """Heurística de seguridad para archivos declarados como texto plano."""
    sample = data[:8192]

    # Un byte nulo en un archivo "de texto" delata contenido binario.
    if b"\x00" in sample:
        raise FileValidationError(
            "El archivo declara ser texto pero contiene datos binarios. "
            "Se rechaza por seguridad.",
            status_code=422,
        )

    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        try:
            sample.decode("latin-1")
        except UnicodeDecodeError:
            raise FileValidationError(
                "No se pudo decodificar el archivo como texto.",
                status_code=422,
            )
