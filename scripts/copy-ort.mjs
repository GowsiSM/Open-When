// Copies the ONNX runtime wasm next to the app so the model runs with no CDN.
import { cpSync, mkdirSync, readdirSync, existsSync } from "node:fs";
const src = "node_modules/onnxruntime-web/dist";
if (!existsSync(src)) { console.warn("onnxruntime-web not found; skipping"); process.exit(0); }
mkdirSync("public/ort", { recursive: true });
for (const f of readdirSync(src)) if (/^ort-wasm.*\.(wasm|mjs)$/.test(f)) cpSync(`${src}/${f}`, `public/ort/${f}`);
