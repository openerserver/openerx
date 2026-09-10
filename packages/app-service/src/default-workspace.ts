import { statSync } from "node:fs";
import path from "node:path";

/** Preserve the original directory on upgrades; never move user files on rename. */
export function defaultWorkspaceDirectory(parentDirectory: string): string {
  const legacy = path.join(parentDirectory, "UWA Workspace");
  try {
    if (statSync(legacy).isDirectory()) return legacy;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return path.join(parentDirectory, "openerx Workspace");
}
