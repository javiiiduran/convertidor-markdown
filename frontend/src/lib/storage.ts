/**
 * Gestión de API keys y modelos en localStorage.
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

/** Modelo seleccionado por proveedor (id del modelo en la API oficial). */
export type SelectedModels = Record<ProviderId, string>;

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  hint: string;
  /** Modelos disponibles; el primero es el recomendado (económico). */
  models: ModelOption[];
}

/**
 * Catálogo de proveedores y modelos con visión.
 *
 * Los IDs son los vigentes en cada API oficial (verificados; un ID
 * inexistente provoca 404). El primero de cada lista es el recomendado:
 * económico y más que suficiente para transcribir a Markdown.
 */
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    hint: "sk-...",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini (Recomendado)" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-5", label: "GPT-5" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    hint: "sk-ant-...",
    models: [
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (Recomendado)" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    ],
  },
  {
    id: "gemini",
    label: "Google (Gemini)",
    hint: "AIza...",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Recomendado)" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hint: "sk-... (solo texto, sin visión)",
    models: [], // la API de DeepSeek no soporta visión actualmente
  },
];

const KEYS_STORAGE_KEY = "mdconv:apiKeys";
const PROVIDER_STORAGE_KEY = "mdconv:activeProvider";
const MODELS_STORAGE_KEY = "mdconv:models";

const EMPTY_KEYS: ApiKeys = { openai: "", anthropic: "", gemini: "", deepseek: "" };

/** Modelo por defecto de cada proveedor: el recomendado (primero de la lista). */
export function getDefaultModels(): SelectedModels {
  return Object.fromEntries(
    PROVIDERS.map((p) => [p.id, p.models[0]?.id ?? ""]),
  ) as SelectedModels;
}

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

/** Carga los modelos elegidos, validando contra el catálogo vigente. */
export function loadSelectedModels(): SelectedModels {
  const defaults = getDefaultModels();
  if (typeof localStorage === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(MODELS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SelectedModels>;
    const result = { ...defaults };
    for (const provider of PROVIDERS) {
      const saved = parsed[provider.id];
      // Solo se acepta un modelo que siga existiendo en el catálogo:
      // protege contra IDs obsoletos guardados en visitas anteriores.
      if (saved && provider.models.some((m) => m.id === saved)) {
        result[provider.id] = saved;
      }
    }
    return result;
  } catch {
    return defaults;
  }
}

/** Guarda los modelos elegidos en localStorage. */
export function saveSelectedModels(models: SelectedModels): void {
  localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
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

/**
 * Devuelve proveedor activo, su key y el modelo elegido (leídos
 * dinámicamente de localStorage en el momento de la conversión).
 */
export function getActiveKey(): { provider: ProviderId; key: string; model: string } {
  const provider = loadActiveProvider();
  const keys = loadApiKeys();
  const models = loadSelectedModels();
  return {
    provider,
    key: keys[provider]?.trim() ?? "",
    model: models[provider] ?? getDefaultModels()[provider],
  };
}
