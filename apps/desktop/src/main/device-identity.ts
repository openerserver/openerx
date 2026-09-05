import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { type DeviceDescriptor, deviceDescriptorSchema } from "@openerx/contracts";
import { desktopBrand } from "../../../../packages/branding/src/index";

export async function loadOrCreateDeviceDescriptor(
  filePath: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): Promise<DeviceDescriptor> {
  try {
    return deviceDescriptorSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const descriptor = deviceDescriptorSchema.parse({
    deviceId: randomUUID(),
    name: hostname().slice(0, 120) || `${desktopBrand.productName} device`,
    platform,
    arch,
  });
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(descriptor, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return descriptor;
}
