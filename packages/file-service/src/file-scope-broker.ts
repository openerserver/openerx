import { copyFileSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { FileRepository, StoredScope } from "@openerx/storage";
import { FileServiceError } from "./errors";

const defaultMaxFiles = 100;

export class FileScopeBroker {
  readonly #repository: FileRepository;

  constructor(repository: FileRepository) {
    this.#repository = repository;
  }

  grant(selectedPath: string, access: "read" | "read_write" = "read"): StoredScope {
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(selectedPath);
    } catch {
      throw new FileServiceError("FILE_NOT_FOUND");
    }
    if (stats.isSymbolicLink()) throw new FileServiceError("FILE_SYMLINK_BLOCKED");
    if (!stats.isFile() && !stats.isDirectory()) throw new FileServiceError("FILE_UNSUPPORTED");
    const canonical = realpathSync.native(selectedPath);
    return this.#repository.createScope({
      kind: stats.isDirectory() ? "directory" : "file",
      displayName: path.basename(canonical),
      rootPath: canonical,
      access,
    });
  }

  selectedFiles(scopeId: string, maxFiles = defaultMaxFiles): string[] {
    const scope = this.assertActive(scopeId);
    if (scope.kind === "file") return [this.resolve(scopeId, path.basename(scope.rootPath))];
    const files: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        const stats = lstatSync(candidate);
        if (stats.isSymbolicLink()) throw new FileServiceError("FILE_SYMLINK_BLOCKED");
        if (stats.isDirectory()) visit(candidate);
        else if (stats.isFile())
          files.push(this.resolve(scopeId, path.relative(scope.rootPath, candidate)));
        if (files.length > maxFiles) throw new FileServiceError("FILE_TOO_LARGE", "Too many files");
      }
    };
    visit(scope.rootPath);
    return files;
  }

  resolve(scopeId: string, relativePath: string): string {
    const scope = this.assertActive(scopeId);
    if (relativePath.includes("\0") || path.isAbsolute(relativePath)) {
      throw new FileServiceError("FILE_PATH_ESCAPE");
    }
    const candidate =
      scope.kind === "file" ? scope.rootPath : path.resolve(scope.rootPath, relativePath);
    const lexical = path.relative(scope.rootPath, candidate);
    if (scope.kind === "directory" && (lexical === ".." || lexical.startsWith(`..${path.sep}`))) {
      throw new FileServiceError("FILE_PATH_ESCAPE");
    }
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(candidate);
    } catch {
      throw new FileServiceError("FILE_NOT_FOUND");
    }
    if (stats.isSymbolicLink()) throw new FileServiceError("FILE_SYMLINK_BLOCKED");
    const canonical = realpathSync.native(candidate);
    if (scope.kind === "file" && canonical !== scope.rootPath) {
      throw new FileServiceError("FILE_PATH_ESCAPE");
    }
    if (scope.kind === "directory") {
      const canonicalRelative = path.relative(scope.rootPath, canonical);
      if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`)) {
        throw new FileServiceError("FILE_PATH_ESCAPE");
      }
    }
    return canonical;
  }

  exportNewFile(scopeId: string, requestedName: string, sourcePath: string): string {
    const scope = this.assertActive(scopeId);
    if (scope.kind !== "directory" || scope.access !== "read_write") {
      throw new FileServiceError("FILE_SCOPE_REVOKED", "Writable directory scope required");
    }
    mkdirSync(scope.rootPath, { recursive: true });
    return this.#copyWithoutOverwrite(scope.rootPath, requestedName, sourcePath);
  }

  exportSelectedPath(selectedPath: string, sourcePath: string): string {
    const requestedName = path.basename(selectedPath);
    let directory: string;
    try {
      directory = realpathSync.native(path.dirname(path.resolve(selectedPath)));
    } catch {
      throw new FileServiceError("FILE_NOT_FOUND", "Selected destination directory is unavailable");
    }
    return this.#copyWithoutOverwrite(directory, requestedName, sourcePath);
  }

  #copyWithoutOverwrite(directory: string, requestedName: string, sourcePath: string): string {
    const safeName = path.basename(requestedName);
    if (!safeName || safeName === "." || safeName === "..") {
      throw new FileServiceError("FILE_PATH_ESCAPE");
    }
    const extension = path.extname(safeName);
    const stem = path.basename(safeName, extension);
    let counter = 0;
    while (counter < 10_000) {
      const name = counter === 0 ? safeName : `${stem} (${counter + 1})${extension}`;
      const destination = path.join(directory, name);
      try {
        copyFileSync(sourcePath, destination, 1);
        return destination;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      counter += 1;
    }
    throw new Error("Unable to allocate a non-overwriting output name");
  }

  assertActive(scopeId: string): StoredScope {
    const scope = this.#repository.scope(scopeId);
    if (scope.revokedAt) throw new FileServiceError("FILE_SCOPE_REVOKED");
    if (scope.expiresAt && Date.parse(scope.expiresAt) <= Date.now()) {
      throw new FileServiceError("FILE_SCOPE_EXPIRED");
    }
    return scope;
  }
}
