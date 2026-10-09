#!/usr/bin/env python3
"""Build a source-only, attributable braces maintenance package from its pinned release."""

import argparse
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "vendor" / "security"
UPSTREAM_URL = "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz"
UPSTREAM_INTEGRITY = "sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA=="
PATCH_URL = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"
FORK_NAME = "@openerx/braces"
FORK_VERSION = "3.0.3-security.1"
ARTIFACT_NAME = "openerx-braces-3.0.3-security.1.tgz"


def replace_once(data, before, after):
    if data.count(before) != 1:
        raise ValueError("BRACES_PATCH_REVIEW_REQUIRED")
    return data.replace(before, after, 1)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def build(source):
    if integrity(source) != UPSTREAM_INTEGRITY:
        raise ValueError("BRACES_UPSTREAM_INTEGRITY_MISMATCH")
    files = {}
    original = {}
    with tarfile.open(fileobj=io.BytesIO(source), mode="r:gz") as archive:
        for entry in archive.getmembers():
            if not entry.isfile() or not entry.name.startswith("package/"):
                continue
            relative = entry.name.removeprefix("package/")
            parts = Path(relative).parts
            if ".." in parts or relative.startswith("/"):
                raise ValueError("BRACES_ARCHIVE_PATH_INVALID")
            if relative.startswith("lib/") or relative in (
                "package.json", "LICENSE", "LICENSE.txt", "README.md", "index.js"
            ):
                data = archive.extractfile(entry).read()
                files[relative] = data
                original[relative] = sha256(data)
    manifest = json.loads(files["package.json"])
    if manifest["name"] != "braces" or manifest["version"] != "3.0.3":
        raise ValueError("BRACES_UPSTREAM_IDENTITY_MISMATCH")
    if "LICENSE" not in files:
        raise ValueError("BRACES_UPSTREAM_LICENSE_MISSING")
    guard = (ROOT / "scripts/security/braces-runtime-guard.cjs").read_bytes()
    files["lib/security.js"] = guard
    for filename in ("parse", "compile", "expand", "stringify"):
        name = "lib/" + filename + ".js"
        files[name] = replace_once(files[name], b"'use strict';\n", b"'use strict';\n\nconst security = require('./security');\n")
        if filename != "parse":
            before = ("const " + filename + " = (ast, options = {}) => {\n").encode() if filename != "stringify" else b"module.exports = (ast, options = {}) => {\n"
            files[name] = replace_once(files[name], before, before + b"  security.assertAst(ast);\n")
    for opening in ("CHAR_LEFT_PARENTHESES", "CHAR_LEFT_CURLY_BRACE"):
        before = ("    if (value === " + opening + ") {\n").encode()
        files["lib/parse.js"] = replace_once(files["lib/parse.js"], before, before + b"      security.assertParseDepth(stack.length);\n")
    files["lib/parse.js"] = replace_once(files["lib/parse.js"], b"  return ast;\n", b"  security.assertAst(ast);\n  return ast;\n")
    for name, ancestor in (("p", "p.parent"), ("block", "block.parent")):
        before = ("    while (" + name + ".type !== 'brace' && " + name + ".type !== 'root' && " + ancestor + ") {\n").encode()
        after = ("    let " + name + "Depth = 0;\n").encode() + before + ("      security.assertParseDepth(" + name + "Depth++);\n").encode()
        files["lib/expand.js"] = replace_once(files["lib/expand.js"], before, after)
    before = files["lib/utils.js"][files["lib/utils.js"].index(b"exports.flatten ="):]
    after = b"""exports.flatten = (...args) => {
  const result = [];
  const active = new WeakSet();
  const stack = [{ values: args, index: 0 }];
  active.add(args);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.values.length) {
      active.delete(frame.values);
      stack.pop();
      continue;
    }
    const value = frame.values[frame.index++];
    if (Array.isArray(value)) {
      if (active.has(value)) throw new RangeError('braces flatten contains an array cycle');
      active.add(value);
      stack.push({ values: value, index: 0 });
    } else if (value !== undefined) {
      result.push(value);
    }
  }
  return result;
};
"""
    files["lib/utils.js"] = replace_once(files["lib/utils.js"], before, after)
    changed = {name: {"originalSha256": original.get(name), "patchedSha256": sha256(data)}
               for name, data in files.items() if original.get(name) != sha256(data)}
    attribution = {
        "upstream": {"name": "braces", "version": "3.0.3", "url": UPSTREAM_URL,
                     "integrity": UPSTREAM_INTEGRITY},
        "patch": {"url": PATCH_URL, "advisory": "GHSA-vfj7-8cjw-p6xm",
                  "source": "Local OpenerX maintenance patch; no official fixed release available.",
                  "guardSource": "scripts/security/braces-runtime-guard.cjs",
                  "guardSourceSha256": sha256(guard), "maxAstDepth": 128, "maxAstNodes": 131074,
                  "changes": changed},
    }
    # Preserve upstream attribution, license, dependencies and the public API.
    for field in ("scripts", "devDependencies", "nyc", "jspm"):
        manifest.pop(field, None)
    manifest.update({"name": FORK_NAME, "version": FORK_VERSION, "private": True,
                     "files": ["index.js", "lib/", "LICENSE", "README.md", "SECURITY_BACKPORT.json"],
                     "openerxSecurityBackport": attribution})
    files["package.json"] = json_bytes(manifest)
    files["SECURITY_BACKPORT.json"] = json_bytes(attribution)
    # Source only; no bundled dependencies, generated output or install script.
    raw_tar = io.BytesIO()
    with tarfile.open(fileobj=raw_tar, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for relative, data in sorted(files.items()):
            entry = tarfile.TarInfo("package/" + relative)
            entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
            entry.uid = entry.gid = 0
            entry.uname = entry.gname = ""
            archive.addfile(entry, io.BytesIO(data))
    compressed = io.BytesIO()
    with gzip.GzipFile(fileobj=compressed, filename="", mode="wb", mtime=0, compresslevel=9) as stream:
        stream.write(raw_tar.getvalue())
    artifact = compressed.getvalue()
    provenance = {
        "schemaVersion": 1, "name": FORK_NAME, "version": FORK_VERSION,
        "license": manifest["license"], **attribution,
        "artifact": {"file": ARTIFACT_NAME, "integrity": integrity(artifact),
                     "sha256": sha256(artifact)},
        "files": {relative: sha256(data) for relative, data in sorted(files.items())},
        "upstreamFileHashes": original,
    }
    return artifact, json_bytes(provenance)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-archive", type=Path,
                        help="Use an already downloaded official release; integrity is still mandatory.")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.source_archive:
        source = args.source_archive.read_bytes()
    else:
        with urllib.request.urlopen(UPSTREAM_URL, timeout=30) as response:
            source = response.read(4_000_000)
    artifact, provenance = build(source)
    target, metadata = OUTPUT / ARTIFACT_NAME, OUTPUT / "braces-backport.json"
    if args.check:
        if target.read_bytes() != artifact or metadata.read_bytes() != provenance:
            raise ValueError("BRACES_BACKPORT_REBUILD_MISMATCH")
    else:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        target.write_bytes(artifact)
        metadata.write_bytes(provenance)
    print("BRACES_BACKPORT_REPRODUCIBLE", target.name, integrity(artifact))


if __name__ == "__main__":
    main()
