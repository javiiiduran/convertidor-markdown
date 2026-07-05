# =============================================================================
# Dockerfile del backend — optimizado para el plan gratuito de Render.
#
# Sin paquetes APT: el OCR local (tesseract) se eliminó porque la CPU del
# plan gratuito dejaba las peticiones colgadas. Las imágenes y PDFs
# escaneados se procesan en el cliente con la API key de LLM del usuario.
# Resultado: build mucho más rápido y contenedor más ligero.
# =============================================================================

FROM python:3.12-slim

# Evitar bytecode en disco y forzar salida sin buffer (logs en tiempo real).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# --- Usuario sin privilegios (principio de mínimo privilegio) ---
RUN useradd --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

# Instalar dependencias primero para aprovechar la caché de capas.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código de la aplicación.
COPY app ./app

USER appuser

# Render inyecta la variable $PORT; 10000 es el valor por defecto de Render.
EXPOSE 10000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
