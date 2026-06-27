// Copia os assets do @3d-dice/dice-box (ammo.wasm + temas) para public/assets/dice-box,
// de onde são servidos. Roda no postinstall para que um npm install já deixe tudo pronto.

import { cp, mkdir, access } from "fs/promises";
import path from "path";

const src = path.resolve("node_modules/@3d-dice/dice-box/dist/assets");
const dest = path.resolve("public/assets/dice-box");

try {
  await access(src);
} catch {
  console.log("[dice-assets] pacote @3d-dice/dice-box não encontrado, pulando.");
  process.exit(0);
}

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log("[dice-assets] assets copiados para public/assets/dice-box");
