import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function packagerTemporaryDirectory(desktopDirectory, temporaryRoot = tmpdir()) {
  const checkout = realpathSync(desktopDirectory);
  const identity = createHash("sha256").update(checkout).digest("hex").slice(0, 24);
  // Packager removes its entire <tmpdir>/electron-packager tree at startup.
  // A checkout-specific parent prevents another edition/worktree removing it.
  return path.join(temporaryRoot, `openerx-packager-${identity}`);
}
