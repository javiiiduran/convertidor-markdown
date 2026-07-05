# Convertidor a Markdown 📄→⬇️

Aplicación web híbrida para convertir archivos (PDF, Office, imágenes, texto)
a Markdown, con arquitectura desacoplada:

| Capa | Tecnología |
|---|---|
| Frontend | Astro + React (islas) + Tailwind CSS 4 — sitio estático (SSG) |
| Backend | FastAPI + PyMuPDF + [markitdown](https://github.com/microsoft/markitdown) |

## Arquitectura híbrida de conversión

```
                        ┌──────────────────────────────────┐
   PDF / Office /       │  Backend FastAPI                 │
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
- **Sin OCR en el servidor**: las imágenes y PDFs escaneados requieren una
  API key de visión, garantizando respuestas rápidas y sin bloqueos. El
  frontend bloquea las imágenes sin key **antes de subir nada**, y si el
  backend detecta un PDF sin texto responde al instante con
  `422 { code: "LLM_REQUIRED" }`.
- **Optimización de memoria**: markitdown se instancia de forma perezosa y
  en modo mínimo (sin plugins ni LLM), de modo que sus detectores basados
  en ONNX (magika/onnxruntime) solo se cargan si entra un documento de
  Office/texto — nunca para PDFs.
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
│   ├── Dockerfile           # Imagen de contenedor para producción
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/      # Islas React (DropZone, ApiKeysPanel, …)
│   │   ├── lib/             # Lógica híbrida + clientes LLM y backend
│   │   ├── layouts/ pages/  # Astro
│   │   └── styles/          # Tailwind 4
│   └── astro.config.mjs
└── .github/workflows/       # Automatizaciones de CI/CD
```


## Privacidad de las API keys

Las llaves de OpenAI / Anthropic / Gemini / DeepSeek se guardan **solo en el
`localStorage` del navegador del usuario** y se usan únicamente en peticiones
`fetch` directas navegador → API oficial. **Nunca se envían a este backend.**


## Link del Convertidor
https://convertidor-markdown.vercel.app/

## Licencia

MIT
