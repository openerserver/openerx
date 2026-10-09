#!/usr/bin/env python3
"""Build a source-only, attributable Forge maintenance package from its pinned release."""

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
UPSTREAM_URL = "https://registry.npmjs.org/node-forge/-/node-forge-1.4.0.tgz"
UPSTREAM_INTEGRITY = "sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ=="
PATCH_URL = "https://github.com/digitalbazaar/forge/pull/1152/commits/ceba34402e329f0365134f23fe19898756527d65"
FORK_NAME = "@openerx/node-forge"
FORK_VERSION = "1.4.0-security.1"
ARTIFACT_NAME = "openerx-node-forge-1.4.0-security.1.tgz"
BEFORE = b"""          // validate DigestInfo structure and element count
          var capture = {};
          var errors = [];
          if(!asn1.validate(obj, digestInfoValidator, capture, errors) ||
            obj.value.length !== 2) {"""
AFTER = b"""          // Validate both sequences: optional parameters must be consumed.
          // Backport #1152 plus empty-NULL validation; see SECURITY_BACKPORT.json.
          var capture = {};
          var errors = [];
          if(!asn1.validate(obj, digestInfoValidator, capture, errors) ||
            obj.value.length !== 2 ||
            obj.value[0].value.length !==
              (('parameters' in capture) ? 2 : 1) ||
            (('parameters' in capture) && capture.parameters !== '')) {"""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def build(source):
    if integrity(source) != UPSTREAM_INTEGRITY:
        raise ValueError("FORGE_UPSTREAM_INTEGRITY_MISMATCH")
    files = {}
    original = {}
    with tarfile.open(fileobj=io.BytesIO(source), mode="r:gz") as archive:
        for entry in archive.getmembers():
            if not entry.isfile() or not entry.name.startswith("package/"):
                continue
            relative = entry.name.removeprefix("package/")
            parts = Path(relative).parts
            if ".." in parts or relative.startswith("/"):
                raise ValueError("FORGE_ARCHIVE_PATH_INVALID")
            if relative.startswith("lib/") or relative in (
                "package.json", "LICENSE", "LICENSE.txt", "README.md"
            ):
                data = archive.extractfile(entry).read()
                files[relative] = data
                original[relative] = sha256(data)
    manifest = json.loads(files["package.json"])
    if manifest["name"] != "node-forge" or manifest["version"] != "1.4.0":
        raise ValueError("FORGE_UPSTREAM_IDENTITY_MISMATCH")
    if "LICENSE" not in files:
        raise ValueError("FORGE_UPSTREAM_LICENSE_MISSING")
    if files["lib/rsa.js"].count(BEFORE) != 1:
        raise ValueError("FORGE_PATCH_REVIEW_REQUIRED")
    files["lib/rsa.js"] = files["lib/rsa.js"].replace(BEFORE, AFTER, 1)
    attribution = {
        "upstream": {"name": "node-forge", "version": "1.4.0", "url": UPSTREAM_URL,
                     "integrity": UPSTREAM_INTEGRITY},
        "patch": {"url": PATCH_URL, "advisory": "GHSA-86w9-cpqp-85rv",
                  "additionalValidation": "AlgorithmIdentifier NULL parameters must be empty (DER); tested against Node crypto.",
                  "originalRsaSha256": original["lib/rsa.js"],
                  "patchedRsaSha256": sha256(files["lib/rsa.js"])},
    }
    # Preserve the original author, contributors, terms, API entry and browser map.
    for field in ("scripts", "devDependencies", "nyc", "jspm"):
        manifest.pop(field, None)
    manifest.update({"name": FORK_NAME, "version": FORK_VERSION, "private": True,
                     "files": ["lib/", "LICENSE", "README.md", "SECURITY_BACKPORT.json"],
                     "openerxSecurityBackport": attribution})
    files["package.json"] = json_bytes(manifest)
    files["SECURITY_BACKPORT.json"] = json_bytes(attribution)
    # No prebuilt browser distribution, Flash binary, dependencies or install script.
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
    target, metadata = OUTPUT / ARTIFACT_NAME, OUTPUT / "node-forge-backport.json"
    if args.check:
        if target.read_bytes() != artifact or metadata.read_bytes() != provenance:
            raise ValueError("FORGE_BACKPORT_REBUILD_MISMATCH")
    else:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        target.write_bytes(artifact)
        metadata.write_bytes(provenance)
    print("FORGE_BACKPORT_REPRODUCIBLE", target.name, integrity(artifact))


if __name__ == "__main__":
    main()
