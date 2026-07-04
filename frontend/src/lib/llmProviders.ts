/**
 * Clientes directos navegador → API oficial de cada proveedor de LLM.
 *
 * PRIVACIDAD: estas peticiones salen directamente del navegador del usuario
 * hacia OpenAI / Anthropic / Google / DeepSeek. Ni el archivo ni la API key
 * pasan jamás por nuestro backend.
 */

import type { ProviderId } from "./storage";

/** Prompt de sistema: transcripción fiel a Markdown impecable. */
const SYSTEM_PROMPT = `Eres un motor de transcripción de documentos a Markdown de máxima precisión.

Tu tarea: transcribir el contenido del archivo adjunto (imagen o PDF) a Markdown impecable.

Reglas estrictas:
1. Transcribe TODO el texto visible, fielmente y en su idioma original.
2. Usa la sintaxis Markdown adecuada: encabezados (#), listas, **negritas**, *cursivas*, tablas GFM, bloques de código, citas (>).
3. Reconstruye las tablas como tablas Markdown alineadas.
4. Describe imágenes/figuras no textuales entre corchetes: [Figura: descripción breve].
5. NO inventes contenido. Si algo es ilegible, escribe [ilegible].
6. NO añadas comentarios, introducciones ni despedidas: responde ÚNICAMENTE con el Markdown resultante.
7. NO envuelvas la respuesta completa en un bloque de código.`;

const USER_INSTRUCTION =
  "Transcribe este archivo a Markdown siguiendo las reglas del sistema.";

export class LlmProviderError extends Error {}

/** Convierte un File a base64 puro (sin el prefijo data:...;base64,). */
export async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new LlmProviderError("El archivo está vacío o es ilegible.");
  return base64;
}

interface LlmRequest {
  base64: string;
  mimeType: string; // p. ej. image/png o application/pdf
  filename: string;
  apiKey: string;
}

/** Despachador principal: enruta al proveedor elegido. */
export async function convertViaLlm(
  provider: ProviderId,
  request: LlmRequest,
): Promise<string> {
  switch (provider) {
    case "openai":
      return convertWithOpenAI(request);
    case "anthropic":
      return convertWithAnthropic(request);
    case "gemini":
      return convertWithGemini(request);
    case "deepseek":
      // La API de DeepSeek (deepseek-chat) no acepta entrada de imágenes/PDF.
      throw new LlmProviderError(
        "DeepSeek no soporta visión (imágenes/PDF) actualmente. " +
          "Elige OpenAI, Anthropic o Gemini, o deja que el backend gratuito " +
          "procese el archivo.",
      );
    default:
      throw new LlmProviderError(`Proveedor desconocido: ${provider}`);
  }
}

/** Lanza un LlmProviderError legible a partir de una respuesta HTTP fallida. */
async function raiseHttpError(providerName: string, response: Response): Promise<never> {
  let detail = "";
  try {
    const body = await response.json();
    detail = body?.error?.message ?? body?.message ?? JSON.stringify(body).slice(0, 300);
  } catch {
    /* sin cuerpo JSON */
  }
  if (response.status === 401 || response.status === 403) {
    throw new LlmProviderError(
      `${providerName}: API key inválida o sin permisos. Revisa el panel de configuración.`,
    );
  }
  if (response.status === 429) {
    throw new LlmProviderError(
      `${providerName}: límite de peticiones o crédito agotado (HTTP 429).`,
    );
  }
  throw new LlmProviderError(
    `${providerName}: error HTTP ${response.status}. ${detail}`.trim(),
  );
}

// ---------------------------------------------------------------------------
// OpenAI — Responses API (soporta imagen y PDF vía base64)
// ---------------------------------------------------------------------------

async function convertWithOpenAI({ base64, mimeType, filename, apiKey }: LlmRequest): Promise<string> {
  const isPdf = mimeType === "application/pdf";
  const fileContent = isPdf
    ? {
        type: "input_file",
        filename,
        file_data: `data:${mimeType};base64,${base64}`,
      }
    : {
        type: "input_image",
        image_url: `data:${mimeType};base64,${base64}`,
      };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      instructions: SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: USER_INSTRUCTION }, fileContent],
        },
      ],
    }),
  });

  if (!response.ok) await raiseHttpError("OpenAI", response);

  const data = await response.json();
  // La Responses API devuelve un array `output` con items de tipo "message".
  const text = (data.output ?? [])
    .filter((item: any) => item.type === "message")
    .flatMap((item: any) => item.content ?? [])
    .filter((part: any) => part.type === "output_text")
    .map((part: any) => part.text)
    .join("\n")
    .trim();

  if (!text) throw new LlmProviderError("OpenAI devolvió una respuesta vacía.");
  return text;
}

// ---------------------------------------------------------------------------
// Anthropic — Messages API (imagen y PDF nativos)
// ---------------------------------------------------------------------------

async function convertWithAnthropic({ base64, mimeType, apiKey }: LlmRequest): Promise<string> {
  const isPdf = mimeType === "application/pdf";
  const fileBlock = isPdf
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      }
    : {
        type: "image",
        source: { type: "base64", media_type: mimeType, data: base64 },
      };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Cabecera requerida por Anthropic para permitir llamadas CORS
      // directas desde el navegador (la key es del propio usuario).
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [fileBlock, { type: "text", text: USER_INSTRUCTION }],
        },
      ],
    }),
  });

  if (!response.ok) await raiseHttpError("Anthropic", response);

  const data = await response.json();
  const text = (data.content ?? [])
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new LlmProviderError("Anthropic devolvió una respuesta vacía.");
  return text;
}

// ---------------------------------------------------------------------------
// Google Gemini — generateContent (imagen y PDF vía inline_data)
// ---------------------------------------------------------------------------

async function convertWithGemini({ base64, mimeType, apiKey }: LlmRequest): Promise<string> {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // La key va en cabecera (no en la URL) para que no quede en logs.
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            parts: [
              { text: USER_INSTRUCTION },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) await raiseHttpError("Gemini", response);

  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part: any) => part.text ?? "")
    .join("\n")
    .trim();

  if (!text) throw new LlmProviderError("Gemini devolvió una respuesta vacía.");
  return text;
}
