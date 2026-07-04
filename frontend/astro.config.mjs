// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// Despliegue: Vercel (detecta Astro automáticamente y sirve desde la raíz).
// La URL del backend se inyecta con la env var PUBLIC_API_URL (ver .env.example).
export default defineConfig({
  output: "static",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
