import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  verifyBracesArchive,
  verifyBracesBackport,
  verifyBracesLocks,
} from "./check-braces-backport.mjs";

const productRoot = fileURLToPath(new URL("../../", import.meta.url));
const repo = path.resolve(process.env.COMPAT_REPO ?? productRoot);
const require = createRequire(path.join(repo, "package.json"));
const entry = require.resolve(process.env.BRACES_MODULE_PATH ?? "braces");
const braces = require(entry),
  directory = path.dirname(entry);
const direct = Object.fromEntries(
  ["parse", "compile", "expand", "stringify"].map((name) => [
    name,
    require(path.join(directory, "lib", `${name}.js`)),
  ]),
);
const deepPattern = (open = "{", close = "}", depth = 4000) =>
  `${open.repeat(depth)}a,b${close.repeat(depth)}`;
function deepAst(depth) {
  const root = { type: "root", nodes: [] };
  let node = root;
  for (let i = 0; i < depth; i++) {
    const child = { type: "paren", nodes: [], parent: node };
    node.nodes.push(child);
    node = child;
  }
  node.nodes.push({ type: "text", value: "x", parent: node });
  return root;
}
const rejectedDepth = (action) =>
  assert.throws(
    action,
    (error) =>
      error instanceof RangeError &&
      error.code === "BRACES_MAX_DEPTH" &&
      !/Maximum call stack/.test(error.message),
  );
const bypass = { maxDepth: false, maxLength: Infinity, rangeLimit: false };

function fixture(callback) {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-braces-integrity-"));
  try {
    const provenance = verifyBracesArchive(productRoot);
    const vendor = path.join(root, "vendor/security"),
      installed = path.join(root, "node_modules/braces");
    mkdirSync(vendor, { recursive: true });
    mkdirSync(installed, { recursive: true });
    for (const name of ["braces-backport.json", provenance.artifact.file])
      cpSync(path.join(productRoot, "vendor/security", name), path.join(vendor, name));
    mkdirSync(path.join(root, "scripts/security"), { recursive: true });
    cpSync(
      path.join(productRoot, provenance.patch.guardSource),
      path.join(root, provenance.patch.guardSource),
    );
    for (const relative of Object.keys(provenance.files)) {
      const target = path.join(installed, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(directory, relative), target);
    }
    const manifest = { name: "openerx-braces-integrity-fixture", version: "1.0.0" };
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": manifest,
        "node_modules/braces": {
          name: provenance.name,
          version: provenance.version,
          resolved: `file:vendor/security/${provenance.artifact.file}`,
          integrity: provenance.artifact.integrity,
        },
      },
    };
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock));
    return callback({ root, installed, lock });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("private maintenance identity, provenance and installed hashes are honest", () => {
  const provenance = verifyBracesArchive(productRoot);
  assert.equal(require(path.join(directory, "package.json")).name, "@openerx/braces");
  assert.equal(
    provenance.patch.source,
    "Local OpenerX maintenance patch; no official fixed release available.",
  );
  if (!process.env.BRACES_MODULE_PATH) assert.ok(verifyBracesBackport(repo).consumers.length > 0);
});

test("all public entries reject deeply nested braces and parentheses below the length limit", () => {
  for (const [open, close] of [
    ["{", "}"],
    ["(", ")"],
    ["{(", ")}"],
  ]) {
    const pattern = deepPattern(open, close, open.length === 2 ? 2000 : 4000);
    assert.ok(pattern.length < 10000);
    for (const run of [
      () => braces(pattern, bypass),
      () => braces(["{x,y}", pattern], bypass),
      () => braces(pattern, { ...bypass, expand: true }),
      ...["parse", "compile", "expand", "stringify", "create"].map(
        (name) => () => braces[name](pattern, bypass),
      ),
    ])
      rejectedDepth(run);
  }
});

test("direct parser and AST walker imports enforce the same non-disableable depth guard", () => {
  rejectedDepth(() => direct.parse(deepPattern(), bypass));
  rejectedDepth(() => direct.parse(deepPattern("(", ")"), bypass));
  for (const name of ["compile", "expand", "stringify"]) {
    rejectedDepth(() => direct[name](deepAst(20000), bypass));
    rejectedDepth(() => braces[name](deepAst(20000), bypass));
  }
});

test("cyclic AST children, pathological width and cyclic ancestor pointers are rejected", () => {
  for (const name of ["compile", "expand", "stringify"]) {
    const root = { type: "root", nodes: [] };
    root.nodes.push(root);
    assert.throws(
      () => direct[name](root),
      (error) => error.code === "BRACES_INVALID_AST",
    );
    assert.throws(
      () => direct[name]({ type: "root", nodes: Array(131075).fill({ type: "text", value: "x" }) }),
      (error) => error.code === "BRACES_MAX_NODES",
    );
  }
  const parentCycle = { type: "paren", nodes: [] };
  parentCycle.parent = parentCycle;
  rejectedDepth(() => direct.expand(parentCycle));
  const leaf = { type: "text", value: "x" };
  assert.equal(
    direct.compile({ type: "root", nodes: [leaf, leaf] }),
    "xx",
    "Ordinary shared leaf nodes are not mistaken for cycles",
  );
});

test("deep and cyclic non-string AST values cannot bypass the depth guard through coercion", () => {
  let nested = ["x"];
  for (let i = 0; i < 20000; i++) nested = [nested];
  const cycle = [];
  cycle.push(cycle);
  for (const field of ["value", "type", "ranges", "commas"]) {
    for (const value of [nested, cycle, { toString: () => "x" }]) {
      for (const name of ["compile", "expand", "stringify"]) {
        const ast = {
          type: "root",
          nodes: [
            { type: "text", value: "x", [field]: value },
            { type: "text", value: "y" },
          ],
        };
        assert.throws(
          () => direct[name](ast),
          (error) => error instanceof TypeError && error.code === "BRACES_INVALID_AST",
        );
        assert.throws(
          () => braces[name](ast),
          (error) => error instanceof TypeError && error.code === "BRACES_INVALID_AST",
        );
      }
    }
  }
});

test("normal alternatives, numeric padding, ranges and empty options retain upstream semantics", () => {
  assert.equal(braces.compile("src/{main,{a,b}}/{001..003}.js"), "src/(main|(a|b))/(00[1-3]).js");
  assert.deepEqual(braces.expand("x/{a,b}{1..3}"), [
    "x/a1",
    "x/a2",
    "x/a3",
    "x/b1",
    "x/b2",
    "x/b3",
  ]);
  assert.deepEqual(braces.expand("{-2..2}"), ["-2", "-1", "0", "1", "2"]);
  assert.deepEqual(braces.expand("{c..a}"), ["c", "b", "a"]);
  assert.deepEqual(braces.expand("{a,a,,b}", { nodupes: true, noempty: true }), ["a", "b"]);
  assert.equal(braces.stringify(braces.parse("foo/{a,b}/bar")), "foo/{a,b}/bar");
  assert.equal(
    braces.stringify("{a,(b,c)}"),
    "{a,(b,c)}",
    "Parser-generated NaN comma counters remain compatible",
  );
  assert.deepEqual(braces(""), [""]);
  assert.throws(() => braces.expand("{1..2000}"), /range limit/);
});

test("quoted, escaped, character-class and moderately nested literals are not rejected", () => {
  const literal = `${"{".repeat(1000)}x${"}".repeat(1000)}`;
  assert.equal(braces.stringify(`'${literal}'`), literal);
  assert.equal(braces.compile(`[${literal}]`), `[${literal}]`);
  assert.equal(braces.stringify("\\{a,b\\}", { keepEscaping: true }), "\\{a,b\\}");
  const nested = `${"{".repeat(120)}x${"}".repeat(120)}`;
  assert.equal(braces.stringify(nested), nested);
  const dollarLiteral = `$${"{a,b}"}`;
  assert.deepEqual(braces.expand(dollarLiteral), [dollarLiteral]);
  assert.equal(braces.stringify("a/{b,c"), "a/{b,c");
});

test("real micromatch consumer keeps glob matching while using the patched braces entry", () => {
  const micromatchEntry = require.resolve("micromatch"),
    consumerRequire = createRequire(micromatchEntry),
    actual = consumerRequire.resolve("braces");
  if (actual !== entry) {
    assert.ok(
      process.env.BRACES_MODULE_PATH,
      "The installed consumer must resolve the vetted package",
    );
    const fixtureModule = new Module(actual);
    fixtureModule.filename = actual;
    fixtureModule.exports = braces;
    fixtureModule.loaded = true;
    require.cache[actual] = fixtureModule;
  }
  const match = require(micromatchEntry);
  assert.deepEqual(match(["src/a.js", "src/b.ts", "src/c.js", "other/a.js"], "src/{a,b}.{js,ts}"), [
    "src/a.js",
    "src/b.ts",
  ]);
  assert.equal(match.isMatch("test/file.md", "{src,test}/**/*.{ts,md}"), true);
  rejectedDepth(() => match.braces(deepPattern(), { expand: true }));
});

test("iterative flatten handles deep arrays and rejects cycles without native recursion", () => {
  const { flatten } = require(path.join(directory, "lib/utils.js"));
  let value = ["leaf", undefined];
  for (let i = 0; i < 30000; i++) value = [value];
  assert.deepEqual(flatten(value), ["leaf"]);
  const repeated = ["one", "two"];
  assert.deepEqual(flatten(repeated, repeated), ["one", "two", "one", "two"]);
  const cycle = [];
  cycle.push(cycle);
  assert.throws(() => flatten(cycle), /array cycle/);
});

test("small-stack process survives hostile inputs and continues ordinary brace operations", () => {
  const script = `const assert=require('node:assert/strict'),b=require(${JSON.stringify(entry)}); const p='{'.repeat(4000)+'a,b'+'}'.repeat(4000); for(const f of [b,b.parse,b.compile,b.expand,b.stringify,b.create]) {assert.throws(()=>f(p,{maxDepth:Infinity,rangeLimit:false}),e=>e.code==='BRACES_MAX_DEPTH');} assert.deepEqual(b.expand('{a,b}'),['a','b']); console.log('BRACES_PROCESS_SURVIVED');`;
  const result = spawnSync(process.execPath, ["--stack_size=512", "-e", script], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BRACES_PROCESS_SURVIVED/);
});

test("archive/lock preflight rejects changed bytes and unexpected package identities before install", () => {
  fixture(({ root, lock }) => {
    verifyBracesLocks(root);
    lock.packages["node_modules/braces"].integrity = "sha512-wrong";
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock));
    assert.throws(() => verifyBracesLocks(root), /BRACES_LOCK_PACKAGE_INTEGRITY/);
    const archive = path.join(root, "vendor/security", verifyBracesArchive(root).artifact.file),
      bytes = readFileSync(archive);
    bytes[100] ^= 1;
    writeFileSync(archive, bytes);
    assert.throws(() => verifyBracesArchive(root));
  });
});

test("installed runtime tampering and nested unvetted consumer resolutions fail the gate", () => {
  fixture(({ root, installed, lock }) => {
    assert.equal(verifyBracesBackport(root).verifiedFiles, 12);
    const guard = path.join(installed, "lib/security.js"),
      original = readFileSync(guard);
    writeFileSync(guard, "module.exports={assertAst(){},assertParseDepth(){}};");
    assert.throws(() => verifyBracesBackport(root), /lib\/security.js/);
    writeFileSync(guard, original);
    const consumer = path.join(root, "node_modules/micromatch"),
      nested = path.join(consumer, "node_modules/braces");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({ name: "micromatch", main: "index.js", dependencies: { braces: "^3.0.3" } }),
    );
    writeFileSync(path.join(consumer, "index.js"), "module.exports=require('braces');");
    writeFileSync(
      path.join(nested, "package.json"),
      JSON.stringify({ name: "braces", version: "3.0.3", main: "index.js" }),
    );
    writeFileSync(path.join(nested, "index.js"), "module.exports=()=>[];");
    lock.packages["node_modules/micromatch"] = { dependencies: { braces: "^3.0.3" } };
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock));
    assert.throws(() => verifyBracesBackport(root), /BRACES_ORIGINAL_UNPATCHED_PACKAGE/);
  });
});

test("optional/peer consumers and every locked nested installation are checked", () => {
  fixture(({ root, lock }) => {
    const consumer = path.join(root, "node_modules/optional-reader"),
      nested = path.join(consumer, "node_modules/braces");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({
        name: "optional-reader",
        main: "index.js",
        optionalDependencies: { braces: "^3.0.3" },
        peerDependencies: { braces: "^3.0.3" },
      }),
    );
    writeFileSync(path.join(consumer, "index.js"), "module.exports=require('braces');");
    writeFileSync(
      path.join(nested, "package.json"),
      JSON.stringify({ name: "braces", version: "3.0.3", main: "index.js" }),
    );
    writeFileSync(path.join(nested, "index.js"), "module.exports=()=>[];");
    lock.packages["node_modules/optional-reader"] = {
      optionalDependencies: { braces: "^3.0.3" },
      peerDependencies: { braces: "^3.0.3" },
    };
    lock.packages["node_modules/optional-reader/node_modules/braces"] = {
      ...lock.packages["node_modules/braces"],
    };
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock));
    assert.throws(() => verifyBracesBackport(root), /BRACES_ORIGINAL_UNPATCHED_PACKAGE/);
  });
});
