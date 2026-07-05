/**
 * Cliente del backend FastAPI (conversión gratuita con markitdown / OCR).
 */

import { API_BASE_URL } from "./config";

export interface BackendConversionResponse {
  filename: string;
  extension: string;
  size_bytes: number;
  engine: string;
  markdown: string;
  warning: string | null;
}

/** Error del backend con código machine-readable opcional. */
export class BackendError extends Error {
  /** P. ej. "LLM_REQUIRED" cuando el archivo necesita visión artificial. */
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Envía el archivo a POST /convert del backend.
 * Lanza Error con mensaje legible si algo falla.
 */
export async function convertViaBackend(
  file: File,
): Promise<BackendConversionResponse> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/convert`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error(
      "No se pudo conectar con el servidor. Si usas el plan gratuito de " +
        "Render, el servicio puede tardar ~50 segundos en despertar; " +
        "inténtalo de nuevo en un momento.",
    );
  }

  if (!response.ok) {
    // El backend devuelve errores uniformes como { detail, code? }.
    let detail = `Error del servidor (HTTP ${response.status}).`;
    let code: string | undefined;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
      if (typeof body?.code === "string") code = body.code;
    } catch {
      /* cuerpo no-JSON: se conserva el mensaje genérico */
    }
    throw new BackendError(detail, code);
  }

  return (await response.json()) as BackendConversionResponse;
}

/** Ping de salud (útil para "despertar" el backend al cargar la página). */
export function wakeUpBackend(): void {
  fetch(`${API_BASE_URL}/ping`).catch(() => {
    /* silencioso: es solo un intento de warm-up */
  });
}
