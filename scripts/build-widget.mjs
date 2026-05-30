// Минификация встраиваемого виджета: widget.js (исходник, который правим) -> widget.min.js
// (файл, который копируется на сайты клиентов и на сервер /var/www/widget/).
//
// Виджет — единый IIFE без импортов, поэтому достаточно transform() без бандлинга.
// Запуск: npm run build:widget
import { transform } from "esbuild";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(root, "widget.js");
const outPath = path.join(root, "widget.min.js");

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));
const src = readFileSync(srcPath, "utf-8");

const result = await transform(src, {
  minify: true,
  target: ["es2018"],
  legalComments: "none",
});

const banner = `/* Zhivaya Skazka widget v${pkg.version} — minified build, do not edit. Source: widget.js */\n`;
const out = banner + result.code;
writeFileSync(outPath, out, "utf-8");

const kb = (n) => (n / 1024).toFixed(1) + " KB";
const rawSize = statSync(srcPath).size;
const minSize = Buffer.byteLength(out, "utf-8");
const gzSize = gzipSync(out).length;

console.log("widget build готов:");
console.log(`  source  widget.js     ${kb(rawSize)}`);
console.log(`  minified widget.min.js ${kb(minSize)}  (-${(100 - (minSize / rawSize) * 100).toFixed(0)}%)`);
console.log(`  gzip                   ${kb(gzSize)}  <- столько реально качает браузер на сайте клиента`);
