import { createHash } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), {
    name: "operator-offline-shell",
    apply: "build",
    writeBundle(options,bundle) {
      const assets = Object.values(bundle).filter(item => item.type === "chunk" ? item.isEntry : item.fileName.endsWith(".css")).map(item => "/"+item.fileName);
      const id = createHash("sha256").update(Object.keys(bundle).sort().join("|")).digest("hex").slice(0,12);
      const manifest = {id,assets:["/","/index.html","/book-mark.svg","/app-icon.png","/manifest.webmanifest",...assets]};
      const source = readFileSync(path.resolve(__dirname,"public/sw.js"),"utf8").replace(/^const BUILD = .*;$/m,"const BUILD = "+JSON.stringify(manifest)+";");
      writeFileSync(path.resolve(options.dir||"dist","sw.js"),source);
      copyFileSync(path.resolve(__dirname,"widget.min.js"),path.resolve(options.dir||"dist","widget.js"));
    },
  }],
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
  server: {
    host: '0.0.0.0',
    port: 1420,
    strictPort: true,
    // Tauri watches Rust itself. Watching Cargo/Gradle output recursively can
    // exhaust Windows memory and terminate the frontend while building Android.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  clearScreen: false,
});
