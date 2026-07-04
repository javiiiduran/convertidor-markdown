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
    // El backend devuelve errores uniformes como { detail: "mensaje" }.
    let detail = `Error del servidor (HTTP ${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* cuerpo no-JSON: se conserva el mensaje genérico */
    }
    throw new Error(detail);
  }

  return (await response.json()) as BackendConversionResponse;
}

/** Ping de salud (útil para "despertar" el backend al cargar la página). */
export function wakeUpBackend(): void {
  fetch(`${API_BASE_URL}/ping`).catch(() => {
    /* silencioso: es solo un intento de warm-up */
  });
}
