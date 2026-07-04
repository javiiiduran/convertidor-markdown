# =============================================================================
# Dockerfile del backend — optimizado para el plan gratuito de Render.
#
# Instala el paquete APT `tesseract-ocr` (+ idiomas español e inglés) para
# el OCR gratuito con pytesseract. Render no permite instalar paquetes APT
# en su runtime nativo de Python, por eso se usa runtime Docker.
# =============================================================================

FROM python:3.12-slim

# Evitar bytecode en disco y forzar salida sin buffer (logs en tiempo real).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# --- Paquetes del sistema: motor OCR Tesseract + idiomas ---
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-spa \
        tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

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
