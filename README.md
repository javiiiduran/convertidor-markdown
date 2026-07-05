# Convertidor a Markdown 📄→⬇️

Aplicación web híbrida para convertir archivos (PDF, Office, imágenes, texto)
a Markdown, diseñada para desplegarse **100% gratis**:

| Capa | Tecnología | Hosting gratuito |
|---|---|---|
| Frontend | Astro + React (islas) + Tailwind CSS 4 | Vercel (deploy automático desde el repo) |
| Backend | FastAPI + PyMuPDF + [markitdown](https://github.com/microsoft/markitdown) | Render (Docker, plan free) |
| Keep-alive | GitHub Actions (cron cada 14 min) | GitHub |

## Arquitectura híbrida de conversión

```
                        ┌──────────────────────────────────┐
   PDF / Office /       │  Backend FastAPI (Render)        │
   texto            ──▶ │  PDF: PyMuPDF (texto nativo)     │
                        │  Office/texto: markitdown (lazy) │
                        └──────────────────────────────────┘

   Imagen / PDF         ┌──────────────────────────────┐
   escaneado CON   ────▶│  fetch directo del navegador │
   API key propia       │  a OpenAI / Anthropic /      │
                        │  Gemini (visión)             │
                        └──────────────────────────────┘

   Imagen / PDF escaneado SIN API key ──▶ aviso inmediato en la UI
   (el servidor no hace OCR: se pide configurar una API key)
```

- **Documentos con texto** (PDF nativo, Office, texto plano) → van a
  `POST /convert` del backend (gratis). Los PDFs usan la ruta rápida de
  PyMuPDF y **no pasan por markitdown**.
- **Sin OCR en el servidor**: la CPU del plan gratuito de Render no puede
  con Tesseract (las peticiones se quedaban colgadas), así que las imágenes
  y PDFs escaneados requieren una API key de visión. El frontend bloquea
  las imágenes sin key **antes de subir nada**, y si el backend detecta un
  PDF sin texto responde al instante con `422 { code: "LLM_REQUIRED" }`.
- **Optimización de RAM (512 MB de Render free)**: markitdown se instancia
  de forma perezosa y en modo mínimo (sin plugins ni LLM), de modo que sus
  detectores basados en ONNX (magika/onnxruntime) solo se cargan si entra
  un documento de Office/texto — nunca para PDFs.
- **Con API key** (OpenAI, Anthropic o Gemini) → las imágenes y PDFs
  escaneados van **directamente del navegador a la API oficial** del
  proveedor. Ni el archivo ni la llave pasan por nuestro servidor.
- **DeepSeek**: su API actual no soporta visión; si es el proveedor activo,
  la UI pide usar OpenAI, Anthropic o Gemini para imágenes/escaneos.

## Seguridad implementada (backend)

- ✅ Límite duro de **10 MB**, verificado durante la lectura del stream (no
  se confía en `Content-Length`).
- ✅ Validación de **Magic Numbers** (firmas de bytes): un `.pdf` debe empezar
  por `%PDF-`, un `.png` por su firma real, etc. Binarios camuflados → 422.
- ✅ Procesamiento **estrictamente en memoria** (`io.BytesIO`): ningún archivo
  toca el disco del servidor.
- ✅ **Sanitización exhaustiva de nombres** (normalización Unicode, lista
  blanca de caracteres, colapso de `..`) → sin Path Traversal.
- ✅ **CORS restringido** a los orígenes del frontend y localhost (nunca `*`),
  configurable vía `FRONTEND_ORIGINS`.
- ✅ Contenedor Docker con **usuario sin privilegios**.

## Estructura del repositorio

```
├── backend/
│   ├── app/
│   │   ├── main.py          # API FastAPI (/ping, /convert) + CORS
│   │   ├── security.py      # Magic numbers, sanitización, lista blanca
│   │   ├── converter.py     # PyMuPDF (PDF) + markitdown lazy (Office)
│   │   └── config.py        # Límites y orígenes CORS
│   ├── Dockerfile           # python-slim, sin paquetes APT (ligero)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/      # Islas React (DropZone, ApiKeysPanel, …)
│   │   ├── lib/             # Lógica híbrida + clientes LLM y backend
│   │   ├── layouts/ pages/  # Astro
│   │   └── styles/          # Tailwind 4
│   └── astro.config.mjs
├── .github/workflows/
│   └── keep_alive.yml       # Ping a Render cada 14 minutos
└── render.yaml              # Blueprint de Render (runtime Docker)
```

## Desarrollo local

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate | Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```


### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # ajusta PUBLIC_API_URL si hace falta
npm run dev            # http://localhost:4321
```

## Despliegue

### 1. Backend en Render

1. Sube el repo a GitHub.
2. En [Render](https://render.com): **New → Blueprint** y selecciona el repo.
   Render leerá `render.yaml` y creará el servicio Docker con `tesseract-ocr`.
3. Cuando Vercel te dé la URL del frontend, añádela a la variable de entorno
   `FRONTEND_ORIGINS` del servicio (lista separada por comas, sin barra
   final). El middleware CORS la lee dinámicamente en cada arranque.


### 2. Frontend en Vercel

1. En [Vercel](https://vercel.com): **Add New → Project** e importa el repo
   de GitHub. Vercel desplegará automáticamente en cada push a `main`.
2. Configuración del proyecto:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Astro (se detecta solo)
3. En **Settings → Environment Variables** añade:
   - `PUBLIC_API_URL` = URL de tu servicio en Render
     (p. ej. `https://convertidor-markdown-api.onrender.com`, sin barra final).
4. Copia la URL de producción que te asigne Vercel y añádela a
   `FRONTEND_ORIGINS` en Render (paso 1.3) para autorizar el CORS.

### 3. Keep-alive

El workflow `keep_alive.yml` hace `curl -f` a `/ping` cada 14 minutos para
evitar la suspensión del plan gratuito de Render.

- (Opcional) Crea la variable de repositorio `RENDER_API_URL` con la URL base
  real de tu servicio; si no existe se usa la URL por defecto del blueprint.
- GitHub desactiva los crons en repos sin actividad tras ~60 días: basta un
  commit o ejecutar el workflow manualmente para reactivarlo.

## Privacidad de las API keys

Las llaves de OpenAI / Anthropic / Gemini / DeepSeek se guardan **solo en el
`localStorage` del navegador del usuario** y se usan únicamente en peticiones
`fetch` directas navegador → API oficial. **Nunca se envían a este backend.**

## Licencia

MIT
