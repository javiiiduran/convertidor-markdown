/**
 * Lógica de conversión híbrida.
 *
 * Reglas de decisión:
 *  - Documento (PDF/Office/texto) -> backend FastAPI (gratis, rápido).
 *  - Imagen o PDF escaneado CON API key de visión -> fetch directo del
 *    navegador a la API oficial (el archivo NUNCA pasa por nuestro backend).
 *  - Imagen SIN API key -> se bloquea INMEDIATAMENTE en el cliente (el
 *    servidor ya no hace OCR local).
 *  - PDF escaneado SIN API key -> el backend responde 422 con
 *    code="LLM_REQUIRED" y se muestra el mismo aviso amigable.
 */

import { IMAGE_MIME_TYPES, MAX_FILE_SIZE_BYTES, PDF_MIME_TYPE } from "./config";
import { BackendError, convertViaBackend } from "./backendClient";
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

/**
 * Error específico: el archivo necesita visión artificial y el usuario
 * no tiene API key configurada. La UI lo muestra como aviso amigable
 * (ámbar), no como error.
 */
export class LlmKeyRequiredError extends Error {}

export const LLM_KEY_REQUIRED_MESSAGE =
  "Las imágenes y PDFs escaneados requieren una API Key (Claude, ChatGPT, " +
  "Gemini o DeepSeek) para ser procesados mediante visión artificial. " +
  "Por favor, agrégala en el panel de Ajustes.";

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
  const hasVisionKey = key.length > 0 && VISION_PROVIDERS.has(provider);

  // --- Validación temprana: las imágenes SIEMPRE necesitan visión ---
  // El backend ya no hace OCR, así que se bloquea aquí, sin subir nada.
  if (isImage && !hasVisionKey) {
    if (key.length > 0) {
      // Tiene key pero de un proveedor sin visión (DeepSeek).
      throw new Error(
        "DeepSeek no soporta visión (imágenes/PDF escaneados). Configura " +
          "una API key de OpenAI, Anthropic o Gemini en el panel de Ajustes.",
      );
    }
    throw new LlmKeyRequiredError(LLM_KEY_REQUIRED_MESSAGE);
  }

  // --- Ruta privada: navegador -> API oficial del proveedor ---
  // Nuestro backend no ve ni el archivo ni la key.
  if ((isImage || isPdf) && hasVisionKey) {
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

  // --- Ruta gratuita: backend FastAPI (PyMuPDF / markitdown) ---
  try {
    const result = await convertViaBackend(file);
    return {
      markdown: result.markdown,
      engine: "backend",
      engineLabel: `Backend gratuito (${result.engine})`,
      warning: result.warning,
    };
  } catch (error) {
    // PDF escaneado detectado por el backend: mismo aviso amigable.
    if (error instanceof BackendError && error.code === "LLM_REQUIRED") {
      throw new LlmKeyRequiredError(LLM_KEY_REQUIRED_MESSAGE);
    }
    throw error;
  }
}
