/**
 * Configuración global del frontend.
 */

/** URL base del backend FastAPI (Render en producción, localhost en dev). */
export const API_BASE_URL: string = (
  import.meta.env.PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

/** Límite de tamaño de archivo: 10 MB (idéntico al del backend). */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Extensiones aceptadas por la zona de drag-and-drop. */
export const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".html",
  ".xml",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tiff",
] as const;

/** Tipos MIME de imagen que pueden ir directas a un LLM con visión. */
export const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const PDF_MIME_TYPE = "application/pdf";
