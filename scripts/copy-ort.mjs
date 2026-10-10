import { cpSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = "node_modules/onnxruntime-web/dist";
const dest = "public/ort";

if (!existsSync(src)) {
  console.error(`ONNX Runtime distribution not found: ${src}`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

const files = readdirSync(src).filter((file) =>
  /^ort-wasm.*\.(wasm|mjs|js)$/.test(file),
);

if (!files.some((file) => file.endsWith(".wasm"))) {
  console.error("No ONNX Runtime WASM files found.");
  process.exit(1);
}

for (const file of files) {
  cpSync(join(src, file), join(dest, file));
}

console.log(`Copied ${files.length} ONNX Runtime assets to ${dest}:`);
for (const file of files) {
  console.log(`  ${file}`);
}
