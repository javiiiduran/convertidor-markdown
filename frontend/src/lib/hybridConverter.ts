/**
 * Lógica de conversión híbrida.
 *
 * Reglas de decisión:
 *  - Documento (PDF/Office/texto) SIN API key      -> backend FastAPI (gratis).
 *  - Imagen o PDF CON API key del proveedor activo -> fetch directo del
 *    navegador a la API oficial (el archivo NUNCA pasa por nuestro backend).
 *  - Imagen SIN API key                            -> backend (OCR gratuito).
 *  - DeepSeek no tiene visión: imágenes/PDF caen al backend con un aviso.
 */

import { IMAGE_MIME_TYPES, MAX_FILE_SIZE_BYTES, PDF_MIME_TYPE } from "./config";
import { convertViaBackend } from "./backendClient";
import { convertViaLlm, fileToBase64 } from "./llmProviders";
import { getActiveKey, PROVIDERS, type ProviderId } from "./storage";

export interface ConversionResult {
  markdown: string;
  /** Motor usado: "backend" o el id del proveedor LLM. */
  engine: "backend" | ProviderId;
  /** Etiqueta legible del motor para mostrar en la UI. */
  engineLabel: string;
  warning: string | null;
}

/** Proveedores con capacidad de visión (imagen y PDF). */
const VISION_PROVIDERS = new Set<ProviderId>(["openai", "anthropic", "gemini"]);

function getMimeType(file: File): string {
  if (file.type) return file.type;
  // Fallback por extensión si el navegador no reporta MIME.
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Convierte un archivo aplicando la estrategia híbrida. */
export async function convertFile(file: File): Promise<ConversionResult> {
  // Validación previa en cliente: evita subir 10+ MB para recibir un 413.
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `"${file.name}" pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. ` +
        `El límite es ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (file.size === 0) {
    throw new Error(`"${file.name}" está vacío.`);
  }

  const mimeType = getMimeType(file);
  const isImage = IMAGE_MIME_TYPES.has(mimeType);
  const isPdf = mimeType === PDF_MIME_TYPE;

  const { provider, key } = getActiveKey();
  const canUseLlm =
    (isImage || isPdf) && key.length > 0 && VISION_PROVIDERS.has(provider);

  if (canUseLlm) {
    // Ruta privada: navegador -> API oficial del proveedor. Nuestro backend
    // no ve ni el archivo ni la key.
    const base64 = await fileToBase64(file);
    const markdown = await convertViaLlm(provider, {
      base64,
      mimeType,
      filename: file.name,
      apiKey: key,
    });
    return {
      markdown,
      engine: provider,
      engineLabel:
        PROVIDERS.find((p) => p.id === provider)?.label ?? provider,
      warning: null,
    };
  }

  // Ruta gratuita: backend FastAPI (markitdown u OCR con tesseract).
  const result = await convertViaBackend(file);

  let warning = result.warning;
  if ((isImage || isPdf) && key.length > 0 && !VISION_PROVIDERS.has(provider)) {
    warning =
      "DeepSeek no soporta visión, así que este archivo se procesó en el " +
      "backend gratuito. Para transcripción con IA usa OpenAI, Anthropic o Gemini." +
      (warning ? ` ${warning}` : "");
  }

  return {
    markdown: result.markdown,
    engine: "backend",
    engineLabel: `Backend gratuito (${result.engine})`,
    warning,
  };
}
