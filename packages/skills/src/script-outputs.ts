import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { type SkillScriptOutput, skillScriptOutputSchema } from "@openerx/contracts";

export type SkillScriptOutputFile = SkillScriptOutput & { bytes: Buffer };
const maxOutputBytes = 10 * 1024 * 1024;
const maxBatchBytes = 50 * 1024 * 1024;

/** Snapshot declared outputs only; never traverse links into host or package files. */
export function readSkillScriptOutputs(
  root: string,
  outputs: SkillScriptOutput[],
): SkillScriptOutputFile[] {
  const seen = new Set<string>();
  let total = 0;
  return outputs.map((raw) => {
    const output = skillScriptOutputSchema.parse(raw);
    if (seen.has(output.relativePath)) throw new Error("SKILL_OUTPUT_DUPLICATE");
    seen.add(output.relativePath);
    let target = root;
    const segments = output.relativePath.split("/");
    for (const [index, segment] of segments.entries()) {
      target = path.join(target, segment);
      const info = lstatSync(target);
      if (
        info.isSymbolicLink() ||
        (index < segments.length - 1 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
      )
        throw new Error("SKILL_OUTPUT_PATH_INVALID");
    }
    const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = fstatSync(descriptor);
      if (!info.isFile() || info.nlink !== 1) throw new Error("SKILL_OUTPUT_PATH_INVALID");
      if (info.size > maxOutputBytes || total + info.size > maxBatchBytes)
        throw new Error("SKILL_OUTPUT_TOO_LARGE");
      const buffer = Buffer.alloc(info.size + 1);
      let read = 0;
      while (read < buffer.byteLength) {
        const count = readSync(descriptor, buffer, read, buffer.byteLength - read, read);
        if (!count) break;
        read += count;
      }
      const bytes = buffer.subarray(0, read);
      if (bytes.byteLength > maxOutputBytes || total + bytes.byteLength > maxBatchBytes)
        throw new Error("SKILL_OUTPUT_TOO_LARGE");
      const current = lstatSync(target);
      if (
        current.isSymbolicLink() ||
        current.nlink !== 1 ||
        current.dev !== info.dev ||
        current.ino !== info.ino ||
        current.size !== info.size ||
        bytes.byteLength !== info.size
      )
        throw new Error("SKILL_OUTPUT_CHANGED");
      total += bytes.byteLength;
      return { ...output, bytes };
    } finally {
      closeSync(descriptor);
    }
  });
}
