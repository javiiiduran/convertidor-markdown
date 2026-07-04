"""
Configuración central del backend.

Todos los valores sensibles o dependientes del entorno se leen de variables
de entorno para poder ajustarlos en Render sin tocar el código.
"""

import os

# ---------------------------------------------------------------------------
# Límites de subida
# ---------------------------------------------------------------------------

# Tamaño máximo de archivo: 10 MB (requisito de seguridad estricto).
MAX_FILE_SIZE_BYTES: int = 10 * 1024 * 1024

# Tamaño de bloque usado al leer el stream de subida (1 MB).
UPLOAD_CHUNK_SIZE: int = 1024 * 1024

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

# Orígenes permitidos por defecto: producción (GitHub Pages / Vercel)
# y desarrollo local. NUNCA usar "*" en producción.
_DEFAULT_ORIGINS = [
    "https://javiiiduran.github.io",
    "https://convertidor-markdown.vercel.app",
    "http://localhost:4321",  # astro dev
    "http://localhost:3000",
    "http://127.0.0.1:4321",
]

def get_allowed_origins() -> list[str]:
    """
    Devuelve la lista de orígenes CORS permitidos.

    Puede sobrescribirse con la variable de entorno FRONTEND_ORIGINS
    (lista separada por comas), p. ej.:
        FRONTEND_ORIGINS=https://miweb.com,https://otra.vercel.app
    """
    raw = os.environ.get("FRONTEND_ORIGINS", "")
    if raw.strip():
        origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
        # Se descarta cualquier comodín por seguridad.
        return [o for o in origins if o != "*"] or _DEFAULT_ORIGINS
    return _DEFAULT_ORIGINS
