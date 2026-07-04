/**
 * Visor del Markdown resultante con acciones de copiar y descargar.
 */

import { useState } from "react";

interface ResultViewerProps {
  markdown: string;
  filename: string;
  engineLabel: string;
  warning: string | null;
}

/** Sustituye la extensión original por .md para la descarga. */
function toMarkdownFilename(original: string): string {
  const stem = original.replace(/\.[^.]+$/, "");
  return `${stem || "documento"}.md`;
}

export default function ResultViewer({
  markdown,
  filename,
  engineLabel,
  warning,
}: ResultViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denegado: sin efecto */
    }
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = toMarkdownFilename(filename);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            ✅ Resultado
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {filename} · procesado con {engineLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {copied ? "✓ Copiado" : "📋 Copiar"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            ⬇️ Descargar .md
          </button>
        </div>
      </div>

      {warning && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
          ⚠️ {warning}
        </div>
      )}

      <textarea
        readOnly
        value={markdown || "(sin contenido extraído)"}
        className="h-96 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
        aria-label="Markdown resultante"
      />
    </section>
  );
}
