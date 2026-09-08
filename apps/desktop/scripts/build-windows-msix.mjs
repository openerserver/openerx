import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const minimumVersion = "10.0.19041.0";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const assetSizes = { StoreLogo: 50, Square44x44Logo: 44, Square150x150Logo: 150 };

function fail(reason) {
  throw new Error(`WINDOWS_MSIX_${reason}`);
}

function textValue(value, name, max = 256) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    fail(`CONFIG_INVALID:${name}`);
  return value;
}

function versionValue(value, name, store = false) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value)
  )
    fail(`CONFIG_INVALID:${name}`);
  const parts = value.split(".").map(Number);
  if (parts.some((part) => part > 65535) || (store && (parts[0] === 0 || parts[3] !== 0)))
    fail(`CONFIG_INVALID:${name}`);
  return value;
}

function compareVersions(first, second) {
  const a = first.split(".").map(Number);
  const b = second.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Identity values must come from the app's Partner Center Product identity page. */
export function validateMsixConfiguration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("CONFIG_INVALID");
  const allowed = new Set([
    "name",
    "publisher",
    "publisherDisplayName",
    "displayName",
    "version",
    "description",
    "executable",
    "minVersion",
    "maxVersionTested",
  ]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`CONFIG_UNKNOWN:${key}`);
  const name = textValue(input.name, "name", 50);
  if (!/^[A-Za-z0-9.-]{3,50}$/u.test(name)) fail("CONFIG_INVALID:name");
  const publisher = textValue(input.publisher, "publisher", 8192);
  if (!/^CN=.+/u.test(publisher)) fail("CONFIG_INVALID:publisher");
  const displayName = textValue(input.displayName, "displayName");
  const executable = textValue(input.executable ?? "OpenERX.exe", "executable", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.exe$/iu.test(executable)) fail("CONFIG_INVALID:executable");
  const minVersion = versionValue(input.minVersion ?? minimumVersion, "minVersion");
  const maxVersionTested = versionValue(input.maxVersionTested ?? minVersion, "maxVersionTested");
  if (
    compareVersions(minVersion, minimumVersion) < 0 ||
    compareVersions(maxVersionTested, minVersion) < 0
  )
    fail("CONFIG_INVALID:windowsVersion");
  return {
    name,
    publisher,
    displayName,
    publisherDisplayName: textValue(input.publisherDisplayName, "publisherDisplayName"),
    version: versionValue(input.version, "version", true),
    description: textValue(input.description ?? displayName, "description", 2048),
    executable,
    minVersion,
    maxVersionTested,
  };
}

function xml(value) {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

export function createMsixManifest(configuration) {
  const c = validateMsixConfiguration(configuration);
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap10 rescap">
  <Identity Name="${xml(c.name)}" Publisher="${xml(c.publisher)}" Version="${c.version}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${xml(c.displayName)}</DisplayName>
    <PublisherDisplayName>${xml(c.publisherDisplayName)}</PublisherDisplayName>
    <Description>${xml(c.description)}</Description>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Resources><Resource Language="zh-CN" /><Resource Language="en-US" /></Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="${c.minVersion}" MaxVersionTested="${c.maxVersionTested}" />
  </Dependencies>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
  <Applications>
    <Application Id="App" Executable="app\\${xml(c.executable)}" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
      <uap:VisualElements DisplayName="${xml(c.displayName)}" Description="${xml(c.description)}"
        Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png" BackgroundColor="transparent" />
    </Application>
  </Applications>
</Package>
`;
}

/** A build never replaces an existing output directory or follows links in payloads. */
export function assertMsixPaths(packageDirectory, outputDirectory) {
  const source = realpathSync(packageDirectory);
  if (!statSync(source).isDirectory() || lstatSync(packageDirectory).isSymbolicLink())
    fail("SOURCE_INVALID");
  const output = path.resolve(outputDirectory);
  if (existsSync(output)) fail("OUTPUT_EXISTS");
  const parent = path.dirname(output);
  if (!existsSync(parent)) fail("OUTPUT_PARENT_MISSING");
  const destination = path.join(realpathSync(parent), path.basename(output));
  const within = (root, candidate) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  };
  if (within(source, destination) || within(destination, source)) fail("PATHS_OVERLAP");
  return { source, output: destination };
}

export function sha256File(file) {
  const hash = createHash("sha256");
  const handle = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = readSync(handle, buffer, 0, buffer.length, null);
    while (bytes > 0) {
      hash.update(buffer.subarray(0, bytes));
      bytes = readSync(handle, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(handle);
  }
  return hash.digest("hex");
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const status = lstatSync(file);
      if (status.isSymbolicLink() || (!status.isDirectory() && !status.isFile()))
        fail("PAYLOAD_LINK_OR_SPECIAL_FILE");
      // MSIX paths use Windows semantics even if a unit test runs on another OS.
      if (/[<>:"|?*]/u.test(entry.name) || /[. ]$/u.test(entry.name)) fail("PAYLOAD_PATH_INVALID");
      if (status.isDirectory()) visit(file);
      else files.push({ file, relative: path.relative(root, file) });
    }
  };
  visit(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function assertX64Executable(file) {
  const handle = openSync(file, "r");
  try {
    const header = Buffer.alloc(64);
    if (readSync(handle, header, 0, 64, 0) !== 64 || header.toString("ascii", 0, 2) !== "MZ")
      fail("EXECUTABLE_INVALID");
    const peOffset = header.readUInt32LE(60);
    if (peOffset < 64 || peOffset > statSync(file).size - 6) fail("EXECUTABLE_INVALID");
    const signature = Buffer.alloc(6);
    readSync(handle, signature, 0, 6, peOffset);
    if (signature.readUInt32LE(0) !== 0x4550 || signature.readUInt16LE(4) !== 0x8664)
      fail("EXECUTABLE_NOT_X64");
  } finally {
    closeSync(handle);
  }
}

function pngDimensions(buffer) {
  if (
    buffer.length < 33 ||
    !buffer.subarray(0, 8).equals(pngSignature) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  )
    fail("LOGO_INVALID");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192) fail("LOGO_INVALID");
  return { width, height };
}

export function createMsixAssets(logoFile, assetsDirectory) {
  const logo = readFileSync(logoFile);
  if (logo.length > 16 * 1024 * 1024) fail("LOGO_TOO_LARGE");
  pngDimensions(logo);
  mkdirSync(assetsDirectory);
  for (const [name, size] of Object.entries(assetSizes)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image href="data:image/png;base64,${logo.toString("base64")}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" /></svg>`;
    const png = new Resvg(svg).render().asPng();
    const dimensions = pngDimensions(png);
    if (dimensions.width !== size || dimensions.height !== size) fail("ASSET_DIMENSIONS_INVALID");
    writeFileSync(path.join(assetsDirectory, `${name}.png`), png, { flag: "wx" });
  }
}

export function findMakeAppx(explicit, env = process.env) {
  if (explicit || env.OPENERX_MAKEAPPX) {
    const candidate = path.resolve(explicit || env.OPENERX_MAKEAPPX);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) fail("MAKEAPPX_NOT_FOUND");
    return candidate;
  }
  const root = path.join(
    env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Windows Kits",
    "10",
    "bin",
  );
  const versions = existsSync(root)
    ? readdirSync(root)
        .filter((name) => /^10\.0\.\d+\.\d+$/u.test(name))
        .sort((a, b) => compareVersions(b, a))
    : [];
  for (const version of versions) {
    const candidate = path.join(root, version, "x64", "makeappx.exe");
    if (existsSync(candidate)) return candidate;
  }
  fail("MAKEAPPX_NOT_FOUND");
}

export function buildWindowsMsix(options, run = execFileSync) {
  const configuration = validateMsixConfiguration(options.configuration);
  const { source, output } = assertMsixPaths(options.packageDirectory, options.outputDirectory);
  const files = listFiles(source);
  assertX64Executable(path.join(source, configuration.executable));
  if (!existsSync(path.join(source, "resources", "app.asar"))) fail("ELECTRON_PAYLOAD_MISSING");
  const makeappx = findMakeAppx(options.makeappx);
  if (!options.logoFile) fail("LOGO_REQUIRED");
  const logoFile = path.resolve(options.logoFile);
  pngDimensions(readFileSync(logoFile));
  // Non-recursive mkdir is the exclusive reservation: a concurrent build fails safely.
  mkdirSync(output);
  const stage = path.join(output, "stage");
  mkdirSync(stage);
  mkdirSync(path.join(stage, "app"));
  for (const { file, relative } of files) {
    const destination = path.join(stage, "app", relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(file, destination, constants.COPYFILE_EXCL);
  }
  createMsixAssets(logoFile, path.join(stage, "Assets"));
  const manifest = createMsixManifest(configuration);
  writeFileSync(path.join(stage, "AppxManifest.xml"), manifest, { flag: "wx" });
  const staged = listFiles(stage).map(({ file, relative }) => ({
    path: relative.replaceAll(path.sep, "/"),
    sha256: sha256File(file),
  }));
  const artifact = path.join(output, `${configuration.name}_${configuration.version}_x64.msix`);
  const unpacked = path.join(output, "verified");
  const invoke = (command, args) => {
    try {
      const result = run(makeappx, [command, ...args], {
        windowsHide: true,
        encoding: "utf8",
        timeout: 15 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
      writeFileSync(path.join(output, `makeappx-${command}.log`), String(result ?? ""), {
        flag: "wx",
      });
    } catch (error) {
      writeFileSync(
        path.join(output, `makeappx-${command}-failed.log`),
        `${error?.message ?? error}\n${error?.stdout ?? ""}\n${error?.stderr ?? ""}`,
        { flag: "wx" },
      );
      fail(`MAKEAPPX_${command.toUpperCase()}_FAILED`);
    }
  };
  // Keep SDK manifest/semantic validation enabled; never use /nv or overwrite /o.
  invoke("pack", ["/d", stage, "/p", artifact, "/h", "SHA256"]);
  if (!existsSync(artifact) || statSync(artifact).size === 0) fail("ARTIFACT_MISSING");
  invoke("unpack", ["/p", artifact, "/d", unpacked]);
  const extracted = listFiles(unpacked);
  for (const entry of staged) {
    const candidate = path.join(unpacked, ...entry.path.split("/"));
    if (!existsSync(candidate) || sha256File(candidate) !== entry.sha256)
      fail(`ROUNDTRIP_MISMATCH:${entry.path}`);
  }
  const known = new Set(staged.map((entry) => entry.path));
  for (const entry of extracted) {
    const relative = entry.relative.replaceAll(path.sep, "/");
    if (!known.has(relative) && !["AppxBlockMap.xml", "[Content_Types].xml"].includes(relative))
      fail(`UNEXPECTED_PACKAGE_FILE:${relative}`);
  }
  const report = {
    schemaVersion: 1,
    channel: "microsoft-store",
    signing: "unsigned-awaiting-store-signing",
    configuration,
    artifact,
    bytes: statSync(artifact).size,
    sha256: sha256File(artifact),
    makeappx,
    makeappxSha256: sha256File(makeappx),
    source,
    logoSource: logoFile,
    logoSha256: sha256File(logoFile),
    verification: "makeappx-semantic-validation-and-payload-roundtrip",
    runtimeValidation: "not-performed",
    payload: staged,
  };
  writeFileSync(
    path.join(output, "msix-build-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx" },
  );
  return report;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node build-windows-msix.mjs --package-dir <Electron x64 directory> --config <Store identity JSON> --output-dir <new directory> [--makeappx <SDK makeappx.exe>] --logo <brand PNG>",
    );
    return;
  }
  if (process.platform !== "win32") fail("WINDOWS_REQUIRED");
  const options = {};
  const names = new Set(["--package-dir", "--config", "--output-dir", "--makeappx", "--logo"]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!names.has(key) || options[key] || !value || value.startsWith("--"))
      fail("ARGUMENT_INVALID");
    options[key] = value;
  }
  for (const key of ["--package-dir", "--config", "--output-dir"])
    if (!options[key]) fail(`ARGUMENT_REQUIRED:${key}`);
  const report = buildWindowsMsix({
    packageDirectory: options["--package-dir"],
    configuration: JSON.parse(readFileSync(options["--config"], "utf8").replace(/^\uFEFF/u, "")),
    outputDirectory: options["--output-dir"],
    makeappx: options["--makeappx"],
    logoFile: options["--logo"],
  });
  console.log(
    `Unsigned Store MSIX: ${report.artifact}\nSHA256: ${report.sha256}\nRuntime validation: not performed`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  }
}
