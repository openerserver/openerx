import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface StoredObject {
  checksumSha256: string;
  objectRef: string;
  absolutePath: string;
  sizeBytes: number;
}

const objectRefPattern = /^objects\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})$/;

export class ContentStore {
  readonly #root: string;

  constructor(profileDirectory: string) {
    this.#root = path.join(profileDirectory, "content");
    mkdirSync(path.join(this.#root, "objects", "sha256"), { recursive: true });
  }

  putFile(sourcePath: string): StoredObject {
    const bytes = readFileSync(sourcePath);
    const stored = this.#target(bytes);
    if (!existsSync(stored.absolutePath)) copyFileSync(sourcePath, stored.absolutePath);
    return stored;
  }

  putBytes(bytes: Uint8Array): StoredObject {
    const stored = this.#target(bytes);
    if (!existsSync(stored.absolutePath)) writeFileSync(stored.absolutePath, bytes);
    return stored;
  }

  resolve(objectRef: string): string {
    const match = objectRefPattern.exec(objectRef);
    if (!match || match[1] !== match[2]?.slice(0, 2)) throw new Error("INVALID_OBJECT_REF");
    return path.join(this.#root, objectRef);
  }

  read(objectRef: string): Buffer {
    return readFileSync(this.resolve(objectRef));
  }

  remove(objectRef: string): void {
    const absolutePath = this.resolve(objectRef);
    if (existsSync(absolutePath)) unlinkSync(absolutePath);
  }

  #target(bytes: Uint8Array): StoredObject {
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const objectRef = `objects/sha256/${checksumSha256.slice(0, 2)}/${checksumSha256}`;
    const absolutePath = path.join(this.#root, objectRef);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    return { checksumSha256, objectRef, absolutePath, sizeBytes: bytes.byteLength };
  }
}
