import { defineConfig } from 'vite';

// Runs on http://localhost:5173 — the game talks to the Groq API directly from the
// browser (Groq allows CORS), using the key you paste into Settings.
export default defineConfig({
  server: { port: 5173, open: true },
  preview: { port: 4173 },
  build: { chunkSizeWarningLimit: 2000 },
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString()) },
});
