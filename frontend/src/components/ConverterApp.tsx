/**
 * Isla principal de la aplicación (client:load).
 *
 * Orquesta: zona de drop, panel de API keys, estado de conversión y
 * visor de resultados. Aplica la lógica híbrida de conversión:
 * backend gratuito vs. llamada directa a la API del LLM del usuario.
 */

import { useCallback, useEffect, useState } from "react";
import ApiKeysPanel from "./ApiKeysPanel";
import DropZone from "./DropZone";
import ResultViewer from "./ResultViewer";
import { wakeUpBackend } from "../lib/backendClient";
import { convertFile, type ConversionResult } from "../lib/hybridConverter";

type Status = "idle" | "converting" | "done" | "error";

export default function ConverterApp() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [hasActiveKey, setHasActiveKey] = useState(false);

  // Warm-up: al cargar la página se hace ping al backend para despertarlo
  // (el plan gratuito de Render duerme tras 15 min de inactividad).
  useEffect(() => {
    wakeUpBackend();
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setStatus("converting");
    setCurrentFile(file.name);
    setResult(null);
    setErrorMessage("");

    try {
      const conversion = await convertFile(file);
      setResult(conversion);
      setStatus("done");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido.",
      );
      setStatus("error");
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* Indicador del modo de conversión activo */}
      <div className="flex items-center justify-between gap-4">
        <span
          className={[
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
            hasActiveKey
              ? "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
          ].join(" ")}
        >
          {hasActiveKey
            ? "🤖 Modo IA: imágenes y PDFs van directos a tu proveedor"
            : "🆓 Modo gratuito: conversión en el backend (markitdown + OCR)"}
        </span>

        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          aria-expanded={showSettings}
        >
          {showSettings ? "Cerrar ajustes ✕" : "⚙️ Ajustes / API Keys"}
        </button>
      </div>

      {showSettings && <ApiKeysPanel onKeysChange={setHasActiveKey} />}

      <DropZone onFile={handleFile} disabled={status === "converting"} />

      {status === "converting" && (
        <div
          className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"
          role="status"
        >
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          Convirtiendo <strong>{currentFile}</strong>… Si el servidor gratuito
          estaba dormido, puede tardar hasta un minuto.
        </div>
      )}

      {status === "error" && (
        <div
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          role="alert"
        >
          ❌ <strong>Error:</strong> {errorMessage}
        </div>
      )}

      {status === "done" && result && (
        <ResultViewer
          markdown={result.markdown}
          filename={currentFile}
          engineLabel={result.engineLabel}
          warning={result.warning}
        />
      )}
    </div>
  );
}
