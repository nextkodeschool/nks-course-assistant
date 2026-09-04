import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // For `npm run dev` outside Docker. In the built image nginx does this
    // instead -- either way the browser only ever talks to its own origin,
    // so no API key is ever visible to client-side JavaScript.
    proxy: { "/api": "http://localhost:8000" },
  },
});
