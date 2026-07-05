"""
API principal del convertidor a Markdown.

Endpoints:
  - GET  /ping     -> keep-alive para el plan gratuito de Render.
  - POST /convert  -> convierte un archivo subido a Markdown.

Principios de seguridad aplicados:
  - CORS restringido a orígenes conocidos (nunca "*").
  - Límite duro de 10 MB verificado durante la lectura del stream
    (no se confía en el header Content-Length).
  - Validación de Magic Numbers antes de procesar.
  - Sanitización de nombres de archivo (anti Path Traversal).
  - Procesamiento 100% en memoria: ningún byte toca el disco.
"""

import logging

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import MAX_FILE_SIZE_BYTES, UPLOAD_CHUNK_SIZE, get_allowed_origins
from .converter import ConversionError, convert_to_markdown
from .security import (
    FileValidationError,
    get_validated_extension,
    sanitize_filename,
    validate_magic_numbers,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("convertidor.api")

app = FastAPI(
    title="Convertidor Markdown API",
    description="Convierte documentos e imágenes a Markdown de forma segura y en memoria.",
    version="1.0.0",
    # Se desactiva la documentación interactiva en producción si se desea
    # reducir superficie; se mantiene activa por ser una API pública inocua.
)

# --- CORS: solo frontend de producción y localhost -------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=False,  # no usamos cookies ni sesiones
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    max_age=86400,
)


# --- Manejadores de error uniformes ----------------------------------------

@app.exception_handler(FileValidationError)
async def handle_validation_error(_, exc: FileValidationError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(ConversionError)
async def handle_conversion_error(_, exc: ConversionError) -> JSONResponse:
    # `code` es machine-readable (p. ej. "LLM_REQUIRED"): el frontend lo usa
    # para distinguir "necesita API key de LLM" de un error genérico.
    content: dict = {"detail": exc.message}
    if exc.code:
        content["code"] = exc.code
    return JSONResponse(status_code=exc.status_code, content=content)


# --- Endpoints ---------------------------------------------------------------

@app.get("/ping", tags=["salud"])
async def ping() -> dict:
    """Endpoint de keep-alive. Respuesta mínima para no consumir recursos."""
    return {"status": "ok", "service": "convertidor-markdown"}


@app.post("/convert", tags=["conversión"])
async def convert(file: UploadFile = File(...)) -> dict:
    """
    Convierte el archivo subido a Markdown.

    Flujo de validación (falla rápido, en orden de coste creciente):
      1. Sanitizar nombre y validar extensión contra lista blanca.
      2. Leer el stream con límite duro de 10 MB.
      3. Verificar Magic Numbers del contenido real.
      4. Convertir en memoria (markitdown u OCR).
    """
    # 1. Nombre seguro + extensión permitida.
    safe_name = sanitize_filename(file.filename)
    extension = get_validated_extension(safe_name)

    # 2. Lectura en memoria con límite estricto. Se lee por bloques para
    #    poder abortar en cuanto se supera el máximo, sin confiar en el
    #    Content-Length declarado por el cliente.
    chunks: list[bytes] = []
    total_size = 0
    while True:
        chunk = await file.read(UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        total_size += len(chunk)
        if total_size > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    "El archivo supera el límite de "
                    f"{MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB."
                ),
            )
        chunks.append(chunk)
    data = b"".join(chunks)

    if not data:
        raise HTTPException(status_code=422, detail="El archivo está vacío.")

    # 3. El contenido real debe coincidir con la extensión declarada.
    validate_magic_numbers(data, extension)

    # 4. Conversión estrictamente en memoria, ejecutada en un hilo del
    #    threadpool: la extracción/OCR es CPU-intensiva y bloquearía el
    #    event loop (dejando /ping sin responder durante la conversión).
    logger.info(
        "Convirtiendo '%s' (%s, %d bytes)", safe_name, extension, total_size
    )
    result = await run_in_threadpool(
        convert_to_markdown, data, extension, safe_name
    )

    return {
        "filename": safe_name,
        "extension": extension,
        "size_bytes": total_size,
        "engine": result["engine"],
        "markdown": result["markdown"],
        "warning": result["warning"],
    }
