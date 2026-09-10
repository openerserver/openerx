import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertMsixPaths,
  buildWindowsMsix,
  createMsixAssets,
  createMsixManifest,
  sha256File,
  validateMsixConfiguration,
} from "../scripts/build-windows-msix.mjs";

const configuration = {
  name: "Tests.MsixFixture",
  publisher: "CN=Fixture & Co",
  publisherDisplayName: "Fixture & Co",
  displayName: 'Fixture "Editor"',
  version: "2.0.1.0",
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const absolute = path.resolve(root);
    if (
      path.dirname(absolute) !== path.resolve(tmpdir()) ||
      !path.basename(absolute).startsWith("openerx-msix-test-")
    )
      throw new Error("Unexpected fixture cleanup path");
    rmSync(absolute, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-msix-test-"));
  roots.push(root);
  const source = path.join(root, "package");
  mkdirSync(path.join(source, "resources"), { recursive: true });
  const pe = Buffer.alloc(128);
  pe.write("MZ");
  pe.writeUInt32LE(64, 60);
  pe.writeUInt32LE(0x4550, 64);
  pe.writeUInt16LE(0x8664, 68);
  writeFileSync(path.join(source, "openerx.exe"), pe);
  writeFileSync(path.join(source, "resources", "app.asar"), "fixture app bytes");
  const makeappx = path.join(root, "makeappx.exe");
  writeFileSync(makeappx, "fixture SDK executable");
  return { root, source, makeappx, output: path.join(root, "output") };
}

describe("Windows Store MSIX configuration", () => {
  it("escapes Store identity and declares one full-trust x64 desktop application", () => {
    const manifest = createMsixManifest(configuration);
    expect(manifest).toContain('Publisher="CN=Fixture &amp; Co"');
    expect(manifest).toContain('DisplayName="Fixture &quot;Editor&quot;"');
    expect(manifest).toContain('ProcessorArchitecture="x64"');
    expect(manifest).toContain('uap10:RuntimeBehavior="packagedClassicApp"');
    expect(manifest).toContain('uap10:TrustLevel="mediumIL"');
    expect(manifest).toContain('Name="runFullTrust"');
    expect(manifest).toContain('MinVersion="10.0.19041.0"');
    expect(manifest).not.toContain("allowElevation");
    expect(manifest).not.toContain("broadFileSystemAccess");
  });

  it.each([
    { version: "2.0.1" },
    { version: "2.0.1.1" },
    { version: "0.0.1.0" },
    { version: "2.0.65536.0" },
    { executable: "../openerx.exe" },
    { executable: "C:\\openerx.exe" },
    { publisher: "" },
    { name: "app/<inject>" },
    { displayName: "hidden\ntext" },
    { minVersion: "10.0.17763.0" },
    { minVersion: "10.0.26100.0", maxVersionTested: "10.0.19041.0" },
    { certificatePassword: "unsupported" },
  ])("rejects invalid or unsupported configuration %j", (overrides) => {
    expect(() => validateMsixConfiguration({ ...configuration, ...overrides })).toThrow(
      "WINDOWS_MSIX_CONFIG_",
    );
  });

  it("refuses missing identity instead of inventing Store values", () => {
    expect(() => validateMsixConfiguration({})).toThrow("CONFIG_INVALID:name");
  });

  it("uses the registered OpenERX Store identity", () => {
    const actual = JSON.parse(
      readFileSync(new URL("../resources/windows-store.json", import.meta.url), "utf8"),
    );
    expect(validateMsixConfiguration(actual).name).toBe("openerx.OpenERX");
    expect(actual.publisher).toBe("CN=6533DE8D-63EF-414A-A709-7316D9261511");
  });
});

describe("MSIX build boundaries and artifact verification", () => {
  it("rejects outputs inside the payload and never replaces an existing directory", () => {
    const f = fixture();
    expect(() => assertMsixPaths(f.source, path.join(f.source, "build"))).toThrow("PATHS_OVERLAP");
    mkdirSync(f.output);
    writeFileSync(path.join(f.output, "retain.txt"), "retain");
    expect(() => assertMsixPaths(f.source, f.output)).toThrow("OUTPUT_EXISTS");
    expect(readFileSync(path.join(f.output, "retain.txt"), "utf8")).toBe("retain");
  });

  it("generates exact-size valid PNGs from the existing brand asset", () => {
    const f = fixture();
    const assets = path.join(f.root, "Assets");
    createMsixAssets(
      fileURLToPath(new URL("../public/assets/openerx-mark.png", import.meta.url)),
      assets,
    );
    for (const [name, size] of Object.entries({
      StoreLogo: 50,
      Square44x44Logo: 44,
      Square150x150Logo: 150,
    })) {
      const bytes = readFileSync(path.join(assets, `${name}.png`));
      expect(bytes.readUInt32BE(16)).toBe(size);
      expect(bytes.readUInt32BE(20)).toBe(size);
    }
  });

  it("rejects the wrong executable architecture before creating output", () => {
    const f = fixture();
    const pe = readFileSync(path.join(f.source, "openerx.exe"));
    pe.writeUInt16LE(0xaa64, 68);
    writeFileSync(path.join(f.source, "openerx.exe"), pe);
    expect(() =>
      buildWindowsMsix({
        configuration,
        packageDirectory: f.source,
        outputDirectory: f.output,
        makeappx: f.makeappx,
      }),
    ).toThrow("EXECUTABLE_NOT_X64");
    expect(existsSync(f.output)).toBe(false);
  });

  it("keeps SDK validation on and verifies every payload byte after extraction", () => {
    const f = fixture();
    const calls: string[][] = [];
    const report = buildWindowsMsix(
      {
        configuration,
        packageDirectory: f.source,
        outputDirectory: f.output,
        makeappx: f.makeappx,
      },
      (_file, args) => {
        calls.push(args);
        const value = (option: string) => args[args.indexOf(option) + 1] as string;
        if (args[0] === "pack") writeFileSync(value("/p"), "fixture package archive");
        else {
          cpSync(path.join(f.output, "stage"), value("/d"), { recursive: true });
          writeFileSync(path.join(value("/d"), "AppxBlockMap.xml"), "blockmap");
          writeFileSync(path.join(value("/d"), "[Content_Types].xml"), "types");
        }
        return "SDK fixture output";
      },
    );
    expect(calls.map((call) => call[0])).toEqual(["pack", "unpack"]);
    expect(calls.flat()).not.toContain("/nv");
    expect(calls.flat()).not.toContain("/o");
    expect(report.sha256).toBe(sha256File(report.artifact));
    expect(report.runtimeValidation).toBe("not-performed");
    expect(report.payload.map((entry) => entry.path)).toContain("app/resources/app.asar");
    expect(existsSync(path.join(f.output, "msix-build-report.json"))).toBe(true);
  });

  it("does not report success when MakeAppx produces no package", () => {
    const f = fixture();
    expect(() =>
      buildWindowsMsix(
        {
          configuration,
          packageDirectory: f.source,
          outputDirectory: f.output,
          makeappx: f.makeappx,
        },
        () => "",
      ),
    ).toThrow("ARTIFACT_MISSING");
    expect(existsSync(path.join(f.output, "msix-build-report.json"))).toBe(false);
  });

  it("fails a package whose extracted payload changed", () => {
    const f = fixture();
    expect(() =>
      buildWindowsMsix(
        {
          configuration,
          packageDirectory: f.source,
          outputDirectory: f.output,
          makeappx: f.makeappx,
        },
        (_file, args) => {
          const value = (option: string) => args[args.indexOf(option) + 1] as string;
          if (args[0] === "pack") writeFileSync(value("/p"), "fixture package archive");
          else {
            cpSync(path.join(f.output, "stage"), value("/d"), { recursive: true });
            writeFileSync(path.join(value("/d"), "app", "openerx.exe"), "changed");
          }
          return "SDK fixture output";
        },
      ),
    ).toThrow("ROUNDTRIP_MISMATCH:app/openerx.exe");
    expect(existsSync(path.join(f.output, "msix-build-report.json"))).toBe(false);
  });
});
