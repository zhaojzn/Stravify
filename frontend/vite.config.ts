import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: { outDir: "dist", sourcemap: true },
  // amazon-cognito-identity-js references `global` (Node-only) and `process`.
  // Map them to browser-safe equivalents.
  define: {
    global: "globalThis",
    "process.env": {},
  },
});
