import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const modelId = "Xenova/clap-htsat-unfused";
const revision = "c28f2883575e590e04d3146ff0713c2448d691ba";
const modelFile = "onnx/audio_model_quantized.onnx";
const modelSize = 34301667;
const modelSha256 = "3fcff2c8824e7bcb83a983f2a49edab3b60cbcf4872ac70efee517355173bd1f";
const chunkSize = 4 * 1024 * 1024;
const assets = [
  ["config.json", 699],
  ["merges.txt", 456318],
  ["preprocessor_config.json", 541],
  ["quantize_config.json", 3044],
  ["special_tokens_map.json", 280],
  ["tokenizer.json", 2108774],
  ["tokenizer_config.json", 1392],
  ["vocab.json", 798293],
];
const modelRoot = join("public", "models", modelId, "resolve", revision);
const downloadRoot = join(".model-download", revision);
const sourcePath = join(downloadRoot, "audio_model_quantized.onnx");
const chunkRoot = join("public", "models", "chunks", revision);
const chunkCount = Math.ceil(modelSize / chunkSize);

const modelFilesReady = assets.every(
  ([file, size]) =>
    existsSync(join(modelRoot, file)) &&
    statSync(join(modelRoot, file)).size === size,
);
const chunksReady = Array.from({ length: chunkCount }, (_, index) => {
  const path = join(
    chunkRoot,
    `audio_model_quantized.onnx.part-${String(index).padStart(3, "0")}`,
  );
  const expected = Math.min(chunkSize, modelSize - index * chunkSize);
  return existsSync(path) && statSync(path).size === expected;
});
if (modelFilesReady && chunksReady.every(Boolean)) {
  console.log(`Pinned CLAP assets already present (${chunkCount} model chunks).`);
  process.exit(0);
}

function sourceUrl(file) {
  return `https://huggingface.co/${modelId}/resolve/${revision}/${file}?download=true`;
}

async function downloadResumable(file, destination, expectedSize) {
  mkdirSync(join(destination, ".."), { recursive: true });
  let currentSize = existsSync(destination) ? statSync(destination).size : 0;
  if (currentSize > expectedSize) {
    rmSync(destination);
    currentSize = 0;
  }
  while (currentSize < expectedSize) {
    const response = await fetch(sourceUrl(file), {
      headers: currentSize ? { Range: `bytes=${currentSize}-` } : undefined,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Model asset ${file} download failed (${response.status} ${response.statusText}).`);
    }
    const append = currentSize > 0 && response.status === 206;
    if (append) {
      const range = response.headers.get("Content-Range");
      if (!range?.startsWith(`bytes ${currentSize}-`)) {
        throw new Error(`Model asset ${file} returned an invalid Content-Range: ${range ?? "missing"}.`);
      }
    } else if (currentSize > 0) {
      currentSize = 0;
    } else if (response.status !== 200) {
      throw new Error(`Model asset ${file} returned unexpected HTTP ${response.status}.`);
    }
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(destination, { flags: append ? "a" : "w" }),
    );
    const nextSize = statSync(destination).size;
    if (nextSize > expectedSize || nextSize <= currentSize) {
      throw new Error(`Model asset ${file} has an unexpected size (${nextSize}/${expectedSize} bytes).`);
    }
    currentSize = nextSize;
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const block of createReadStream(path)) hash.update(block);
  return hash.digest("hex");
}

mkdirSync(modelRoot, { recursive: true });
mkdirSync(downloadRoot, { recursive: true });
for (const [file, size] of assets) {
  const response = await fetch(sourceUrl(file));
  if (!response.ok) {
    throw new Error(`Model asset ${file} download failed (${response.status} ${response.statusText}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== size) {
    throw new Error(`Model asset ${file} was ${bytes.length} bytes; expected ${size}.`);
  }
  writeFileSync(join(modelRoot, file), bytes);
  console.log(`Downloaded ${file} (${bytes.length} bytes).`);
}

await downloadResumable(modelFile, sourcePath, modelSize);
if (await sha256(sourcePath) !== modelSha256) {
  rmSync(sourcePath);
  throw new Error(`SHA-256 verification failed for ${modelFile}.`);
}

rmSync(chunkRoot, { recursive: true, force: true });
mkdirSync(chunkRoot, { recursive: true });
const basename = modelFile.split("/").at(-1);
for (let index = 0; index < chunkCount; index++) {
  const start = index * chunkSize;
  const end = Math.min(start + chunkSize, modelSize) - 1;
  const output = join(
    chunkRoot,
    `${basename}.part-${String(index).padStart(3, "0")}`,
  );
  await pipeline(
    createReadStream(sourcePath, { start, end }),
    createWriteStream(output),
  );
}
rmSync(sourcePath);
writeFileSync(
  join("public", "models", "chunks", "manifest.json"),
  JSON.stringify({ revision, modelFile, modelSize, chunkSize, chunkCount }),
);
rmSync(downloadRoot, { recursive: true, force: true });
console.log(`Verified and split ${modelFile} into ${chunkCount} resumable chunks.`);
