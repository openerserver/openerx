import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as imageSize from "image-size";
import { expect, test } from "vitest";
import { adaptLegacyImageSize } from "../../scripts/dmg-image-size.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1WQAAAAASUVORK5CYII=",
  "base64",
);

test("DMG background sizing preserves path/callback and buffer APIs", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-image-size-"));
  try {
    const file = path.join(root, "background.png");
    writeFileSync(file, png);
    const sizeOf = adaptLegacyImageSize(imageSize);
    expect(sizeOf(png)).toMatchObject({ width: 1, height: 1 });
    expect(sizeOf(file)).toMatchObject({ width: 1, height: 1 });
    expect(sizeOf.imageSize).toBe(imageSize.imageSize);
    const fromFile = (file: string) =>
      new Promise((resolve, reject) =>
        sizeOf(file, (error, size) => (error ? reject(error) : resolve(size))),
      );
    await expect(fromFile(file)).resolves.toMatchObject({ width: 1, height: 1 });
    await expect(fromFile(path.join(root, "missing.png"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    writeFileSync(file, "not an image");
    await expect(fromFile(file)).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a zero-length ICNS entry is rejected without hanging the build", () => {
  // Isolate the parser so reintroducing the old infinite loop cannot hang Vitest.
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import { imageSize } from 'image-size';
      const input = Buffer.from('69636e73000000106963303700000000', 'hex');
      try { imageSize(input); process.exitCode = 1; }
      catch (error) { if (!/Invalid ICNS/.test(error.message)) process.exitCode = 2; }
    `,
    ],
    {
      cwd: path.resolve(import.meta.dirname, "../.."),
      timeout: 5000,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
