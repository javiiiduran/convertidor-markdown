/**
 * Gestión de API keys en localStorage.
 *
 * PRIVACIDAD: las llaves se guardan EXCLUSIVAMENTE en el navegador del
 * usuario. Nunca se envían a nuestro backend; solo viajan directamente
 * a la API oficial del proveedor elegido (OpenAI, Anthropic, Google o
 * DeepSeek) cuando el propio usuario inicia una conversión.
 */

export type ProviderId = "openai" | "anthropic" | "gemini" | "deepseek";

export interface ApiKeys {
  openai: string;
  anthropic: string;
  gemini: string;
  deepseek: string;
}

export const PROVIDERS: { id: ProviderId; label: string; hint: string }[] = [
  { id: "openai", label: "OpenAI (ChatGPT)", hint: "sk-..." },
  { id: "anthropic", label: "Anthropic (Claude)", hint: "sk-ant-..." },
  { id: "gemini", label: "Google (Gemini)", hint: "AIza..." },
  { id: "deepseek", label: "DeepSeek", hint: "sk-... (solo texto, sin visión)" },
];

const KEYS_STORAGE_KEY = "mdconv:apiKeys";
const PROVIDER_STORAGE_KEY = "mdconv:activeProvider";

const EMPTY_KEYS: ApiKeys = { openai: "", anthropic: "", gemini: "", deepseek: "" };

/** Carga las API keys guardadas (o un objeto vacío si no hay nada). */
export function loadApiKeys(): ApiKeys {
  if (typeof localStorage === "undefined") return { ...EMPTY_KEYS };
  try {
    const raw = localStorage.getItem(KEYS_STORAGE_KEY);
    if (!raw) return { ...EMPTY_KEYS };
    const parsed = JSON.parse(raw) as Partial<ApiKeys>;
    return { ...EMPTY_KEYS, ...parsed };
  } catch {
    // JSON corrupto: se descarta de forma segura.
    return { ...EMPTY_KEYS };
  }
}

/** Guarda las API keys en localStorage (solo en este navegador). */
export function saveApiKeys(keys: ApiKeys): void {
  localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
}

/** Elimina todas las API keys guardadas. */
export function clearApiKeys(): void {
  localStorage.removeItem(KEYS_STORAGE_KEY);
}

/** Proveedor activo elegido por el usuario. */
export function loadActiveProvider(): ProviderId {
  if (typeof localStorage === "undefined") return "openai";
  const value = localStorage.getItem(PROVIDER_STORAGE_KEY) as ProviderId | null;
  return value && PROVIDERS.some((p) => p.id === value) ? value : "openai";
}

export function saveActiveProvider(provider: ProviderId): void {
  localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
}

/** Devuelve la key del proveedor activo, o cadena vacía si no está configurada. */
export function getActiveKey(): { provider: ProviderId; key: string } {
  const provider = loadActiveProvider();
  const keys = loadApiKeys();
  return { provider, key: keys[provider]?.trim() ?? "" };
}
