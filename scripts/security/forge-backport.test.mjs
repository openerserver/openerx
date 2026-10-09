import assert from "node:assert/strict";
import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  X509Certificate,
} from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  resolveDeclaredConsumer,
  verifyForgeArchive,
  verifyForgeBackport,
  verifyForgeLocks,
} from "./check-forge-backport.mjs";

// Use generated keys and genuine signatures, including normally signed
// DigestInfo values that exercise strict ASN.1 structure checks. No persisted
// private keys, external keys, padding bypasses, or signature forgery fixtures.
// Set COMPAT_REPO to test an isolated install. FORGE_MODULE_PATH may
// point to an isolated patched Forge entrypoint without changing node_modules.
const productRoot = fileURLToPath(new URL("../../", import.meta.url));
const repo = resolve(process.env.COMPAT_REPO ?? productRoot);
const require = createRequire(join(repo, "package.json"));
const forgeEntry = require.resolve(process.env.FORGE_MODULE_PATH ?? "node-forge");
const forge = require(forgeEntry);
const expoEntry = resolveDeclaredConsumer(repo, "@expo/code-signing-certificates");
const expoForgeEntry = expoEntry ? createRequire(expoEntry).resolve("node-forge") : null;
if (process.env.FORGE_MODULE_PATH && expoForgeEntry && forgeEntry !== expoForgeEntry) {
  // Point the consumer at the chosen test module in this process only.
  const fixtureModule = new Module(expoForgeEntry);
  fixtureModule.filename = expoForgeEntry;
  fixtureModule.exports = forge;
  fixtureModule.loaded = true;
  require.cache[expoForgeEntry] = fixtureModule;
}
const expo = expoEntry ? require(expoEntry) : null;
const expoOptions = { skip: expo ? false : "Expo is not declared by this standalone installation" };

const algorithms = ["sha256", "sha384", "sha512"];
const message = Buffer.from("openerx compatibility test: 中文, emoji 🚀, binary\0\u0001", "utf8");
const changedMessage = Buffer.from(message);
changedMessage[0] ^= 1;
const forgePair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
const forgePrivatePem = forge.pki.privateKeyToPem(forgePair.privateKey);
const forgePublicPem = forge.pki.publicKeyToPem(forgePair.publicKey);
const nodePrivate = createPrivateKey(forgePrivatePem);
const nodePublic = createPublicKey(forgePublicPem);
const nodePair = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 0x10001 });
const nodeImportedPrivate = forge.pki.privateKeyFromPem(
  nodePair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
);
const nodeImportedPublic = forge.pki.publicKeyFromPem(
  nodePair.publicKey.export({ type: "spki", format: "pem" }).toString(),
);

const binary = (value) => Buffer.from(value).toString("binary");
function digest(algorithm, value = message) {
  return forge.md[algorithm].create().update(binary(value));
}
function flipSignature(value) {
  const result = Buffer.from(value);
  result[result.length - 1] ^= 1;
  return result;
}
function rejected(verify) {
  let result = false;
  try {
    result = verify();
  } catch {
    // Forge can either return false or report invalid encoding/padding.
  }
  assert.notEqual(result, true);
}
function createCertificate(algorithm, pair = forgePair, commonName = "openerx compatibility") {
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = pair.publicKey;
  certificate.serialNumber = "0123456789abcdef";
  const now = Math.floor(Date.now() / 1000) * 1000;
  certificate.validity.notBefore = new Date(now - 60_000);
  certificate.validity.notAfter = new Date(now + 86_400_000);
  const attributes = [{ name: "commonName", value: commonName }];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", digitalSignature: true, keyCertSign: true },
    { name: "extKeyUsage", codeSigning: true },
    { name: "subjectKeyIdentifier" },
  ]);
  certificate.sign(pair.privateKey, forge.md[algorithm].create());
  return certificate;
}

function digestInfo(algorithm, parameters = "empty-null", extraOuterElement = false) {
  const { asn1 } = forge;
  const element = (type, value, constructed = false) =>
    asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
  const algorithmFields = [element(asn1.Type.OID, asn1.oidToDer(forge.oids[algorithm]).getBytes())];
  switch (parameters) {
    case "empty-null":
      algorithmFields.push(element(asn1.Type.NULL, ""));
      break;
    case "absent":
      break;
    case "extra-algorithm-element":
      algorithmFields.push(element(asn1.Type.NULL, ""), element(asn1.Type.OCTETSTRING, "unused"));
      break;
    case "unknown-second-element":
      algorithmFields.push(element(asn1.Type.OCTETSTRING, "unused"));
      break;
    case "nonempty-null":
      algorithmFields.push(element(asn1.Type.NULL, "\x00"));
      break;
    case "constructed-null":
      algorithmFields.push(element(asn1.Type.NULL, [], true));
      break;
    default:
      throw new Error(`Unknown DigestInfo fixture: ${parameters}`);
  }
  const fields = [
    element(asn1.Type.SEQUENCE, algorithmFields, true),
    element(asn1.Type.OCTETSTRING, digest(algorithm).digest().getBytes()),
  ];
  if (extraOuterElement) {
    fields.push(element(asn1.Type.OCTETSTRING, "unused"));
  }
  return asn1.toDer(element(asn1.Type.SEQUENCE, fields, true)).getBytes();
}

function signDigestInfo(algorithm, parameters, extraOuterElement = false) {
  // The held private key signs the exact fixture using normal PKCS#1 v1.5
  // padding. NONE omits only automatic DigestInfo construction, allowing its
  // ordinary and abnormal ASN.1 shapes to be checked by the public verifier.
  return forgePair.privateKey.sign(digestInfo(algorithm, parameters, extraOuterElement), "NONE");
}

function backportFixture(context, { hoisted = false } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "openerx-forge-backport-test-"));
  const root = hoisted ? join(temporary, "core") : temporary;
  const installationRoot = hoisted ? temporary : root;
  context.after(() => rmSync(temporary, { recursive: true, force: true }));
  const provenance = verifyForgeArchive(productRoot);
  const vendorDirectory = join(root, "vendor/security");
  const installedDirectory = join(installationRoot, "node_modules/node-forge");
  const sourceDirectory = resolve(dirname(forgeEntry), "..");
  mkdirSync(vendorDirectory, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "openerx-forge-fixture", private: true }),
  );
  for (const filename of ["node-forge-backport.json", provenance.artifact.file]) {
    writeFileSync(
      join(vendorDirectory, filename),
      readFileSync(join(productRoot, "vendor/security", filename)),
    );
  }
  // Only the 53 source/provenance files tracked by the package are copied.
  // No runtime distribution, dependency tree, user profile, or product writes.
  for (const relative of Object.keys(provenance.files)) {
    const target = join(installedDirectory, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(sourceDirectory, relative)));
  }
  const lock = {
    name: "openerx-forge-fixture",
    lockfileVersion: 3,
    packages: {
      "": { name: "openerx-forge-fixture", private: true },
      "node_modules/node-forge": {
        name: provenance.name,
        version: provenance.version,
        resolved: `file:vendor/security/${provenance.artifact.file}`,
        integrity: provenance.artifact.integrity,
      },
    },
  };
  for (const [name, version] of [
    ["@expo/cli", "57.0.18"],
    ["@expo/code-signing-certificates", "0.0.6"],
  ]) {
    const location = `node_modules/${name}`;
    const manifest = { name, version, main: "index.js", dependencies: { "node-forge": "^1.3.3" } };
    lock.packages[location] = { version, dependencies: manifest.dependencies };
    const directory = join(installationRoot, location);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(directory, "index.js"), "module.exports = {};\n");
  }
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
  if (hoisted) {
    const outerLock = structuredClone(lock);
    outerLock.packages[""].workspaces = ["core/apps/*"];
    outerLock.packages["core/apps/mobile"] = { name: "@openerx/mobile", version: "2.0.5" };
    outerLock.packages["node_modules/node-forge"].resolved =
      `file:core/vendor/security/${provenance.artifact.file}`;
    writeFileSync(
      join(temporary, "package.json"),
      JSON.stringify({ name: "uwa-fixture", private: true, workspaces: ["core/apps/*"] }),
    );
    writeFileSync(join(temporary, "package-lock.json"), JSON.stringify(outerLock));
  }
  return { root, installationRoot, installedDirectory, vendorDirectory, provenance, lock };
}

test("package guard accepts a genuine source-only backport fixture", (context) => {
  const { root, provenance } = backportFixture(context);
  const result = verifyForgeBackport(root);
  assert.equal(result.name, provenance.name);
  assert.equal(result.version, provenance.version);
  assert.equal(result.verifiedFiles, Object.keys(provenance.files).length);
  assert.equal(result.verifiedPackageDirectories, 1);
  assert.equal(result.locks.length, 1);
  assert.equal(result.consumers.length, 2);
  assert.equal(new Set(result.consumers.map((consumer) => consumer.forgeDirectory)).size, 1);
  assert.deepEqual(result.skippedConsumers, []);
  assert.match(resolveDeclaredConsumer(root, "@expo/code-signing-certificates"), /index\.js$/u);
  assert.equal(verifyForgeLocks(root).locks.length, 1);
});

test("package guard rejects an independently nested unpatched consumer without cache injection", (context) => {
  const { root, installationRoot } = backportFixture(context);
  const nested = join(installationRoot, "node_modules/@expo/cli/node_modules/node-forge");
  mkdirSync(join(nested, "lib"), { recursive: true });
  writeFileSync(
    join(nested, "package.json"),
    JSON.stringify({ name: "node-forge", version: "1.4.0", main: "lib/index.js" }),
  );
  writeFileSync(join(nested, "lib/index.js"), "module.exports = {};\n");
  // No prior resolution is cached for this unique fixture. The locked root
  // package is valid; the CLI's own createRequire must find its nested copy.
  assert.throws(() => verifyForgeBackport(root), /FORGE_ORIGINAL_UNPATCHED_PACKAGE/);
});

test("package guard rejects an incorrect locked maintenance integrity", (context) => {
  const { root, lock } = backportFixture(context);
  lock.packages["node_modules/node-forge"].integrity = "sha512-incorrect";
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
  assert.throws(() => verifyForgeBackport(root), /FORGE_LOCK_PACKAGE_INTEGRITY/);
  assert.throws(() => verifyForgeLocks(root), /FORGE_LOCK_PACKAGE_INTEGRITY/);
});

test("package guard reports a precisely missing optional consumer", (context) => {
  const { root, installationRoot, lock } = backportFixture(context);
  lock.packages["node_modules/@expo/cli"].optional = true;
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
  rmSync(join(installationRoot, "node_modules/@expo/cli"), { recursive: true, force: true });
  const result = verifyForgeBackport(root);
  assert.equal(result.consumers.length, 1);
  assert.deepEqual(result.skippedConsumers, [
    {
      lockFile: join(root, "package-lock.json"),
      location: "node_modules/@expo/cli",
      package: "@expo/cli",
      reason: "optional_not_installed",
    },
  ]);
  rmSync(join(installationRoot, "node_modules/@expo/code-signing-certificates"), {
    recursive: true,
    force: true,
  });
  assert.throws(
    () => resolveDeclaredConsumer(root, "@expo/code-signing-certificates"),
    /FORGE_DECLARED_CONSUMER_MISSING/,
  );
  delete lock.packages["node_modules/@expo/code-signing-certificates"];
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
  assert.equal(resolveDeclaredConsumer(root, "@expo/code-signing-certificates"), null);
});

test("package guard checks both UWA locks and naturally resolves hoisted consumers once", (context) => {
  const { root } = backportFixture(context, { hoisted: true });
  const result = verifyForgeBackport(root);
  assert.equal(result.locks.length, 2);
  assert.equal(result.consumers.length, 4);
  assert.equal(result.verifiedPackageDirectories, 1);
  assert.ok(
    result.consumers.every((consumer) =>
      consumer.directory.includes(`${join("node_modules", "@expo")}${sep}`),
    ),
  );
});

test("package guard rejects a real installed-source byte change", (context) => {
  const { root, installedDirectory } = backportFixture(context);
  assert.doesNotThrow(() => verifyForgeBackport(root));
  const file = join(installedDirectory, "lib/rsa.js");
  writeFileSync(
    file,
    Buffer.concat([readFileSync(file), Buffer.from("\n// fixture byte change\n")]),
  );
  assert.throws(() => verifyForgeBackport(root), /lib\/rsa\.js/);
});

test("package guard rejects the original unpatched package identity", (context) => {
  const { root, installedDirectory } = backportFixture(context);
  assert.doesNotThrow(() => verifyForgeBackport(root));
  const file = join(installedDirectory, "package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.name = "node-forge";
  manifest.version = "1.4.0";
  writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => verifyForgeBackport(root), /FORGE_ORIGINAL_UNPATCHED_PACKAGE/);
});

test("package guard rejects a real archive byte change", (context) => {
  const { root, vendorDirectory, provenance } = backportFixture(context);
  assert.doesNotThrow(() => verifyForgeArchive(root));
  const file = join(vendorDirectory, provenance.artifact.file);
  writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from([0])]));
  assert.throws(() => verifyForgeArchive(root), { code: "ERR_ASSERTION" });
});

test("PEM import/export interoperates with Node.js RSA keys", () => {
  assert.equal(nodePrivate.asymmetricKeyType, "rsa");
  assert.equal(nodePublic.asymmetricKeyDetails.modulusLength, 2048);
  assert.ok(nodeImportedPrivate.n.equals(nodeImportedPublic.n));
  assert.equal(nodeImportedPublic.e.toString(), "65537");
  const imported = forge.pki.privateKeyFromPem(
    nodePrivate.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  assert.ok(imported.n.equals(forgePair.privateKey.n));
  const publicImported = forge.pki.publicKeyFromPem(
    nodePublic.export({ type: "spki", format: "pem" }).toString(),
  );
  assert.ok(publicImported.n.equals(forgePair.publicKey.n));
});

for (const algorithm of algorithms) {
  test(`${algorithm}: normal DigestInfo with empty or omitted NULL is accepted`, () => {
    const hash = digest(algorithm).digest().getBytes();
    const withNull = signDigestInfo(algorithm, "empty-null");
    assert.equal(forgePair.publicKey.verify(hash, withNull), true);
    assert.equal(nodeVerify(algorithm, message, nodePublic, Buffer.from(withNull, "binary")), true);
    assert.equal(forgePair.publicKey.verify(hash, signDigestInfo(algorithm, "absent")), true);
  });

  for (const fixture of [
    "extra-algorithm-element",
    "unknown-second-element",
    "nonempty-null",
    "constructed-null",
  ]) {
    test(`${algorithm}: normally signed DigestInfo rejects ${fixture}`, () => {
      const signature = signDigestInfo(algorithm, fixture);
      const hash = digest(algorithm).digest().getBytes();
      assert.equal(
        nodeVerify(algorithm, message, nodePublic, Buffer.from(signature, "binary")),
        false,
      );
      rejected(() => forgePair.publicKey.verify(hash, signature));
    });
  }

  test(`${algorithm}: normally signed DigestInfo rejects an extra outer element`, () => {
    const signature = signDigestInfo(algorithm, "empty-null", true);
    assert.equal(
      nodeVerify(algorithm, message, nodePublic, Buffer.from(signature, "binary")),
      false,
    );
    rejected(() => forgePair.publicKey.verify(digest(algorithm).digest().getBytes(), signature));
  });

  test(`${algorithm}: genuine PKCS#1 v1.5 signatures interoperate in both directions`, () => {
    const forgeDigest = digest(algorithm);
    const hashBytes = forgeDigest.digest().getBytes();
    assert.equal(
      Buffer.from(hashBytes, "binary").toString("hex"),
      createHash(algorithm).update(message).digest("hex"),
    );
    const forgeSignature = Buffer.from(forgePair.privateKey.sign(forgeDigest), "binary");
    assert.equal(forgeSignature.length, 256);
    assert.equal(nodeVerify(algorithm, message, nodePublic, forgeSignature), true);
    assert.equal(forgePair.publicKey.verify(hashBytes, binary(forgeSignature)), true);
    const nodeSignature = nodeSign(algorithm, message, nodePrivate);
    assert.deepEqual(nodeSignature, forgeSignature);
    assert.equal(forgePair.publicKey.verify(hashBytes, binary(nodeSignature)), true);
    const importedSignature = Buffer.from(nodeImportedPrivate.sign(digest(algorithm)), "binary");
    assert.equal(nodeVerify(algorithm, message, nodePair.publicKey, importedSignature), true);
    const signatureFromNodePair = nodeSign(algorithm, message, nodePair.privateKey);
    assert.equal(nodeImportedPublic.verify(hashBytes, binary(signatureFromNodePair)), true);
  });

  test(`${algorithm}: changed message, corrupted signature, and wrong key are rejected`, () => {
    const signature = nodeSign(algorithm, message, nodePrivate);
    const corruptSignature = flipSignature(signature);
    rejected(() =>
      forgePair.publicKey.verify(digest(algorithm).digest().getBytes(), binary(corruptSignature)),
    );
    rejected(() =>
      forgePair.publicKey.verify(
        digest(algorithm, changedMessage).digest().getBytes(),
        binary(signature),
      ),
    );
    rejected(() =>
      nodeImportedPublic.verify(digest(algorithm).digest().getBytes(), binary(signature)),
    );
    assert.equal(nodeVerify(algorithm, message, nodePublic, corruptSignature), false);
    assert.equal(nodeVerify(algorithm, changedMessage, nodePublic, signature), false);
    assert.equal(nodeVerify(algorithm, message, nodePair.publicKey, signature), false);
  });

  test(`${algorithm}: X.509 creation, parsing, and signature validation interoperate`, () => {
    const certificate = createCertificate(algorithm);
    const pem = forge.pki.certificateToPem(certificate);
    const parsed = forge.pki.certificateFromPem(pem, true);
    assert.equal(parsed.subject.getField("CN").value, "openerx compatibility");
    assert.equal(parsed.serialNumber, certificate.serialNumber);
    assert.equal(parsed.validity.notBefore.getTime(), certificate.validity.notBefore.getTime());
    assert.equal(parsed.verify(parsed), true);
    assert.equal(parsed.getExtension("extKeyUsage").codeSigning, true);
    const x509 = new X509Certificate(pem);
    assert.match(x509.subject, /CN=openerx compatibility/);
    assert.equal(x509.verify(nodePublic), true);
    assert.equal(x509.checkPrivateKey(nodePrivate), true);

    const damaged = forge.pki.certificateFromPem(pem, true);
    damaged.signature = binary(flipSignature(Buffer.from(damaged.signature, "binary")));
    rejected(() => parsed.verify(damaged));
    const damagedX509 = new X509Certificate(forge.pki.certificateToPem(damaged));
    assert.equal(damagedX509.verify(nodePublic), false);
  });

  test(`${algorithm}: generated CSR survives PEM round-trip and rejects signature corruption`, () => {
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = forgePair.publicKey;
    csr.setSubject([{ name: "commonName", value: "openerx CSR compatibility" }]);
    csr.sign(forgePair.privateKey, forge.md[algorithm].create());
    const parsed = forge.pki.certificationRequestFromPem(
      forge.pki.certificationRequestToPem(csr),
      true,
    );
    assert.equal(parsed.verify(), true);
    assert.equal(parsed.subject.getField("CN").value, "openerx CSR compatibility");
    parsed.signature = binary(flipSignature(Buffer.from(parsed.signature, "binary")));
    rejected(() => parsed.verify());
  });
}

test("ordinary RSA-PSS signatures remain compatible with Node.js crypto", () => {
  const scheme = () =>
    forge.pss.create({
      md: forge.md.sha256.create(),
      mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
      saltLength: 32,
    });
  const forgeSignature = Buffer.from(
    forgePair.privateKey.sign(digest("sha256"), scheme()),
    "binary",
  );
  const nodeOptions = {
    key: nodePublic,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  };
  assert.equal(nodeVerify("sha256", message, nodeOptions, forgeSignature), true);
  const nodeSignature = nodeSign("sha256", message, { ...nodeOptions, key: nodePrivate });
  assert.equal(
    forgePair.publicKey.verify(
      digest("sha256").digest().getBytes(),
      binary(nodeSignature),
      scheme(),
    ),
    true,
  );
  rejected(() =>
    forgePair.publicKey.verify(
      digest("sha256").digest().getBytes(),
      binary(flipSignature(nodeSignature)),
      scheme(),
    ),
  );
});

test(
  "Expo code signing creates, parses, validates, and signs a real certificate",
  expoOptions,
  () => {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const certificate = expo.generateSelfSignedCodeSigningCertificate({
      keyPair: forgePair,
      validityNotBefore: new Date(now - 60_000),
      validityNotAfter: new Date(now + 86_400_000),
      commonName: "openerx Expo compatibility",
    });
    const pem = expo.convertCertificateToCertificatePEM(certificate);
    const parsed = expo.convertCertificatePEMToCertificate(pem);
    const convertedKeys = expo.convertKeyPairPEMToKeyPair(expo.convertKeyPairToPEM(forgePair));
    assert.doesNotThrow(() => expo.validateSelfSignedCertificate(parsed, convertedKeys));
    const signature = Buffer.from(
      expo.signBufferRSASHA256AndVerify(convertedKeys.privateKey, parsed, message),
      "base64",
    );
    assert.equal(
      nodeVerify("sha256", message, new X509Certificate(pem).publicKey, signature),
      true,
    );
    assert.equal(nodeVerify("sha256", changedMessage, nodePublic, signature), false);
    parsed.signature = binary(flipSignature(Buffer.from(parsed.signature, "binary")));
    assert.throws(() => expo.validateSelfSignedCertificate(parsed, convertedKeys));
  },
);

test("Expo CSR and development certificate flow remains valid", expoOptions, () => {
  const issuer = createCertificate("sha256", forgePair, "openerx development issuer");
  const csr = expo.generateCSR(
    { privateKey: nodeImportedPrivate, publicKey: nodeImportedPublic },
    "openerx development",
  );
  const parsedCsr = expo.convertCSRPEMToCSR(expo.convertCSRToCSRPEM(csr));
  assert.equal(parsedCsr.verify(), true);
  const certificate = expo.generateDevelopmentCertificateFromCSR(
    forgePair.privateKey,
    issuer,
    parsedCsr,
    "11111111-1111-4111-8111-111111111111",
    "compatibility-scope",
  );
  const pem = expo.convertCertificateToCertificatePEM(certificate);
  const parsedCertificate = expo.convertCertificatePEMToCertificate(pem);
  assert.equal(issuer.verify(parsedCertificate), true);
  assert.equal(new X509Certificate(pem).verify(nodePublic), true);
  assert.equal(
    parsedCertificate.getExtension({ id: expo.expoProjectInformationOID }).value,
    "11111111-1111-4111-8111-111111111111,compatibility-scope",
  );
  const signature = Buffer.from(
    expo.signBufferRSASHA256AndVerify(nodeImportedPrivate, parsedCertificate, message),
    "base64",
  );
  assert.equal(nodeVerify("sha256", message, nodePair.publicKey, signature), true);
});

console.log(`# Compatibility target: ${forgeEntry}`);
console.log(`# Node.js runtime: ${process.version}`);
