import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  css: {
    modules: {
      localsConvention: "camelCase",
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@monaco-editor") || id.includes("monaco-editor")) {
              return "monaco";
            }
            if (id.includes("react") || id.includes("react-dom")) {
              return "react-core";
            }
            if (id.includes("framer-motion") || id.includes("lucide-react")) {
              return "animations-icons";
            }
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});