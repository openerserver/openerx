import { rmSync } from "node:fs";
import path from "node:path";

const buildDirectory = path.resolve(import.meta.dirname, "../.vite/build");
for (const fileName of [
  "pi-host-test.js",
  "pi-host-test.js.map",
  "platform-alpha-test.mjs",
  "platform-alpha-test.mjs.map",
]) {
  rmSync(path.join(buildDirectory, fileName), { force: true });
}
