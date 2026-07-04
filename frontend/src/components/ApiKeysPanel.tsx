/**
 * Panel de configuración de API keys de proveedores LLM.
 *
 * Las llaves se guardan EXCLUSIVAMENTE en localStorage del navegador.
 * Nunca se envían a nuestro backend.
 */

import { useEffect, useState } from "react";
import {
  clearApiKeys,
  loadActiveProvider,
  loadApiKeys,
  PROVIDERS,
  saveActiveProvider,
  saveApiKeys,
  type ApiKeys,
  type ProviderId,
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
  const [activeProvider, setActiveProvider] = useState<ProviderId>("openai");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [savedMessage, setSavedMessage] = useState(false);

  // Cargar estado persistido al montar (solo en cliente).
  useEffect(() => {
    setKeys(loadApiKeys());
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
        ⚙️ API Keys (opcional)
      </h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Con una API key, las imágenes y PDFs escaneados se transcriben con IA
        de visión directamente desde tu navegador.
      </p>

      {/* Aviso de privacidad destacado */}
      <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
        🔒 <strong>Privacidad garantizada:</strong> tus llaves se guardan solo
        en el <code>localStorage</code> de este navegador y viajan únicamente
        del navegador a la API oficial del proveedor.{" "}
        <strong>Nunca tocan nuestro servidor.</strong>
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

      {/* Inputs de keys por proveedor */}
      <div className="space-y-3">
        {PROVIDERS.map((p) => (
          <label key={p.id} className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {p.label}
            </span>
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
          </label>
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
