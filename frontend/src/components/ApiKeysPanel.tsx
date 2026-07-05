/**
 * Panel de configuración de API keys y modelos de proveedores LLM.
 *
 * Las llaves y la selección de modelo se guardan EXCLUSIVAMENTE en
 * localStorage del navegador. Nunca se envían a nuestro backend.
 */

import { useEffect, useState } from "react";
import {
  clearApiKeys,
  getDefaultModels,
  loadActiveProvider,
  loadApiKeys,
  loadSelectedModels,
  PROVIDERS,
  saveActiveProvider,
  saveApiKeys,
  saveSelectedModels,
  type ApiKeys,
  type ProviderId,
  type SelectedModels,
} from "../lib/storage";

interface ApiKeysPanelProps {
  /** Notifica al padre si hay al menos una key configurada. */
  onKeysChange?: (hasActiveKey: boolean) => void;
}

export default function ApiKeysPanel({ onKeysChange }: ApiKeysPanelProps) {
  const [keys, setKeys] = useState<ApiKeys>({
    openai: "",
    anthropic: "",
    gemini: "",
    deepseek: "",
  });
  const [models, setModels] = useState<SelectedModels>(getDefaultModels());
  const [activeProvider, setActiveProvider] = useState<ProviderId>("openai");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [savedMessage, setSavedMessage] = useState(false);

  // Cargar estado persistido al montar (solo en cliente).
  useEffect(() => {
    setKeys(loadApiKeys());
    setModels(loadSelectedModels());
    setActiveProvider(loadActiveProvider());
  }, []);

  useEffect(() => {
    onKeysChange?.(Boolean(keys[activeProvider]?.trim()));
  }, [keys, activeProvider, onKeysChange]);

  const handleSave = () => {
    // Se guardan las keys sin espacios accidentales.
    const trimmed = Object.fromEntries(
      Object.entries(keys).map(([k, v]) => [k, v.trim()]),
    ) as unknown as ApiKeys;
    saveApiKeys(trimmed);
    saveSelectedModels(models);
    saveActiveProvider(activeProvider);
    setKeys(trimmed);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 2500);
  };

  const handleClear = () => {
    clearApiKeys();
    setKeys({ openai: "", anthropic: "", gemini: "", deepseek: "" });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-1 text-lg font-bold text-slate-800 dark:text-slate-100">
        ⚙️ API Keys y modelos (opcional)
      </h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Con una API key, las imágenes y PDFs escaneados se transcriben con IA
        de visión directamente desde tu navegador.
      </p>

      {/* Aviso de privacidad destacado */}
      <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
        🔒 <strong>Privacidad garantizada:</strong> tus llaves se guardan solo
        en el <code>localStorage</code> de este navegador y viajan únicamente
        del navegador a la API oficial del proveedor.{" "}
        <strong>Nunca tocan nuestro servidor.</strong>
      </div>

      {/* Nota sobre la elección de modelo */}
      <div className="mb-5 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300">
        💡 <strong>Nota:</strong> Los modelos marcados como (Recomendado) son
        más que suficientes y sumamente económicos para extraer información y
        formatear a Markdown con total precisión. El uso de modelos avanzados
        queda a tu total elección y consumo de créditos.
      </div>

      {/* Selector de proveedor activo */}
      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Proveedor activo
        </span>
        <select
          value={activeProvider}
          onChange={(e) => setActiveProvider(e.target.value as ProviderId)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {keys[p.id]?.trim() ? " ✓" : ""}
            </option>
          ))}
        </select>
      </label>

      {/* Key + selector de modelo por proveedor */}
      <div className="space-y-4">
        {PROVIDERS.map((p) => (
          <div
            key={p.id}
            className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
          >
            <span className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-300">
              {p.label}
            </span>

            {/* API key */}
            <div className="flex gap-2">
              <input
                type={visible[p.id] ? "text" : "password"}
                value={keys[p.id]}
                onChange={(e) =>
                  setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))
                }
                placeholder={p.hint}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() =>
                  setVisible((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
                }
                aria-label={visible[p.id] ? "Ocultar key" : "Mostrar key"}
                className="rounded-lg border border-slate-300 px-3 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {visible[p.id] ? "🙈" : "👁️"}
              </button>
            </div>

            {/* Selector de modelo (proveedores con visión) */}
            {p.models.length > 0 ? (
              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  Modelo
                </span>
                <select
                  value={models[p.id]}
                  onChange={(e) =>
                    setModels((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {p.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                Sin visión: no procesa imágenes ni PDFs escaneados.
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Acciones */}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
        >
          Guardar en este navegador
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
        >
          Borrar todas
        </button>
        {savedMessage && (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            ✓ Guardado
          </span>
        )}
      </div>
    </section>
  );
}
