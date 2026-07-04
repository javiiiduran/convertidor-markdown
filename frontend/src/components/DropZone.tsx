/**
 * Zona robusta de Drag-and-Drop para subir archivos.
 * Acepta también clic para abrir el selector nativo.
 */

import { useCallback, useRef, useState, type DragEvent } from "react";
import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from "../lib/config";

interface DropZoneProps {
  onFile: (file: File) => void;
  disabled: boolean;
}

export default function DropZone({ onFile, disabled }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Contador de drag para no parpadear al pasar sobre elementos hijos.
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault(); // necesario para permitir el drop
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      if (disabled) return;
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [disabled, onFile],
  );

  const handleSelect = () => {
    const file = inputRef.current?.files?.[0];
    if (file) onFile(file);
    // Permitir volver a elegir el mismo archivo.
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Zona para soltar o seleccionar archivos"
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={[
        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-200 select-none",
        disabled
          ? "cursor-wait opacity-60"
          : "cursor-pointer hover:border-sky-400 hover:bg-sky-50/50 dark:hover:bg-sky-950/30",
        isDragging
          ? "scale-[1.01] border-sky-500 bg-sky-50 dark:bg-sky-950/40"
          : "border-slate-300 dark:border-slate-700",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        onChange={handleSelect}
        disabled={disabled}
      />

      <div className="text-5xl" aria-hidden="true">
        {isDragging ? "📥" : "📄"}
      </div>

      <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">
        {isDragging
          ? "¡Suéltalo aquí!"
          : "Arrastra un archivo o haz clic para elegirlo"}
      </p>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        PDF, Word, Excel, PowerPoint, imágenes (PNG/JPG/WebP), texto…
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Tamaño máximo: {MAX_FILE_SIZE_BYTES / 1024 / 1024} MB
      </p>
    </div>
  );
}
