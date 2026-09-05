import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FuseV1Options, FuseVersion, flipFuses } from "@electron/fuses";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { releaseUpdateConfigurationSchema } from "@openerx/contracts";
import { loadDesktopBrand } from "../../packages/branding/src/node";

const releaseMode = process.env.OPENERX_RELEASE_MODE === "1";
const desktopBrand = loadDesktopBrand();
const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const macEntitlements = path.join(desktopDirectory, "resources", "entitlements.mac.plist");
const macChildEntitlements = path.join(
  desktopDirectory,
  "resources",
  "entitlements.mac.inherit.plist",
);
const macBrowserHelperBuildScript = path.join(
  desktopDirectory,
  "scripts",
  "build-macos-browser-helper.mjs",
);
const windowsBrowserHelperSource = path.join(
  desktopDirectory,
  "native",
  "windows-browser-accessibility.ps1",
);

const resvgNativePackages: Record<string, string> = {
  "darwin-arm64": "@resvg/resvg-js-darwin-arm64",
  "darwin-x64": "@resvg/resvg-js-darwin-x64",
  "linux-arm64": "@resvg/resvg-js-linux-arm64-gnu",
  "linux-armv7l": "@resvg/resvg-js-linux-arm-gnueabihf",
  "linux-x64": "@resvg/resvg-js-linux-x64-gnu",
  "win32-arm64": "@resvg/resvg-js-win32-arm64-msvc",
  "win32-ia32": "@resvg/resvg-js-win32-ia32-msvc",
  "win32-x64": "@resvg/resvg-js-win32-x64-msvc",
};

function copyRuntimePackage(buildPath: string, packageName: string): void {
  const source = path.dirname(require.resolve(`${packageName}/package.json`));
  const destination = path.join(buildPath, "node_modules", ...packageName.split("/"));
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: true });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`RELEASE_ENV_REQUIRED:${name}`);
  return value;
}

function updateConfiguration() {
  if (!releaseMode) {
    return releaseUpdateConfigurationSchema.parse({
      enabled: false,
      channel: "internal",
      manifestUrl: null,
      keyId: null,
      publicKeyPem: null,
    });
  }
  const publicKeyPem = Buffer.from(
    requiredEnvironment("OPENERX_UPDATE_PUBLIC_KEY_BASE64"),
    "base64",
  ).toString("utf8");
  if (!publicKeyPem.includes("BEGIN PUBLIC KEY")) throw new Error("RELEASE_PUBLIC_KEY_INVALID");
  return releaseUpdateConfigurationSchema.parse({
    enabled: true,
    channel: requiredEnvironment("OPENERX_RELEASE_CHANNEL"),
    manifestUrl: requiredEnvironment("OPENERX_UPDATE_MANIFEST_URL"),
    keyId: requiredEnvironment("OPENERX_UPDATE_KEY_ID"),
    publicKeyPem,
  });
}

function signingConfiguration(): Partial<ForgeConfig["packagerConfig"]> {
  if (process.platform === "darwin") {
    const configuredIdentity = process.env.OPENERX_MAC_SIGN_IDENTITY?.trim();
    if (!releaseMode && !configuredIdentity) return {};
    const identity = configuredIdentity || requiredEnvironment("OPENERX_MAC_SIGN_IDENTITY");
    const osxSign = {
      identity,
      ignore: (filePath: string) => /\.(?:asar|bin|dat|pak)$/iu.test(filePath),
      optionsForFile: (filePath: string) => ({
        hardenedRuntime: true,
        entitlements:
          path.basename(filePath) === `${desktopBrand.executableName}.app`
            ? macEntitlements
            : macChildEntitlements,
      }),
    };
    if (!releaseMode) return { osxSign };
    return {
      osxSign,
      osxNotarize: {
        appleApiKey: requiredEnvironment("APPLE_API_KEY"),
        appleApiKeyId: requiredEnvironment("APPLE_API_KEY_ID"),
        appleApiIssuer: requiredEnvironment("APPLE_API_ISSUER"),
      },
    };
  }
  if (!releaseMode) return {};
  if (process.platform === "win32") {
    return {
      windowsSign: {
        certificateFile: requiredEnvironment("WINDOWS_CERTIFICATE_FILE"),
        certificatePassword: requiredEnvironment("WINDOWS_CERTIFICATE_PASSWORD"),
        description: desktopBrand.description,
        website: requiredEnvironment("OPENERX_PROJECT_URL"),
      },
    };
  }
  throw new Error("RELEASE_HOST_PLATFORM_UNSUPPORTED");
}

const config: ForgeConfig = {
  outDir: process.env.OPENERX_PACKAGE_OUT_DIR
    ? path.resolve(process.env.OPENERX_PACKAGE_OUT_DIR)
    : undefined,
  packagerConfig: {
    asar: {
      unpack: "**/{*.node,openerx-browser-accessibility,windows-browser-accessibility.ps1}",
    },
    appBundleId: desktopBrand.appBundleId,
    appCategoryType: "public.app-category-type.productivity",
    appCopyright: `Copyright © 2026 ${desktopBrand.publisher}`,
    executableName: desktopBrand.executableName,
    extendInfo: {
      NSAppleEventsUsageDescription: `${desktopBrand.productName} 仅在您逐次批准桌面操作后，使用系统自动化控制您指定的应用。`,
    },
    name: desktopBrand.productName,
    ...signingConfiguration(),
  },
  hooks: {
    packageAfterCopy: async (forgeConfig, buildPath, _electronVersion, platform, arch) => {
      const legalDirectory = path.join(buildPath, "legal");
      mkdirSync(legalDirectory, { recursive: true });
      for (const file of [
        "LICENSE",
        "NOTICE",
        "THIRD_PARTY_NOTICES.md",
        "THIRD_PARTY_LICENSES.txt",
      ]) {
        cpSync(path.resolve(desktopDirectory, "../..", file), path.join(legalDirectory, file));
      }
      mkdirSync(path.join(legalDirectory, "third-party"), { recursive: true });
      cpSync(
        path.resolve(desktopDirectory, "../../third-party/notices.json"),
        path.join(legalDirectory, "third-party/notices.json"),
      );
      if (["darwin", "mas"].includes(platform)) {
        execFileSync(
          process.execPath,
          [
            macBrowserHelperBuildScript,
            "--output",
            path.join(buildPath, "native", "openerx-browser-accessibility"),
            "--arch",
            arch,
          ],
          { stdio: "inherit" },
        );
      }
      if (platform === "win32") {
        const nativeDirectory = path.join(buildPath, "native");
        mkdirSync(nativeDirectory, { recursive: true });
        cpSync(
          windowsBrowserHelperSource,
          path.join(nativeDirectory, "windows-browser-accessibility.ps1"),
        );
      }
      const resvgNativePackage = resvgNativePackages[`${platform}-${arch}`];
      if (!resvgNativePackage) {
        throw new Error(`RESVG_NATIVE_TARGET_UNSUPPORTED:${platform}-${arch}`);
      }
      copyRuntimePackage(buildPath, "@resvg/resvg-js");
      copyRuntimePackage(buildPath, resvgNativePackage);

      const releaseDirectory = path.join(buildPath, "release");
      mkdirSync(releaseDirectory, { recursive: true });
      writeFileSync(
        path.join(releaseDirectory, "update-config.json"),
        `${JSON.stringify(updateConfiguration(), null, 2)}\n`,
        { mode: 0o644 },
      );
      const appBasePath = path.resolve(buildPath, "../..");
      const executablePath = ["darwin", "mas"].includes(platform)
        ? path.join(appBasePath, "MacOS", desktopBrand.executableName)
        : path.join(
            appBasePath,
            platform === "win32" ? "electron.exe" : desktopBrand.executableName,
          );
      const hasMacSigning = Boolean(forgeConfig.packagerConfig.osxSign);

      await flipFuses(executablePath, {
        version: FuseVersion.V1,
        strictlyRequireAllFuses: true,
        resetAdHocDarwinSignature:
          !hasMacSigning && ["darwin", "mas"].includes(platform) && arch === "arm64",
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
        [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
        [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
        [FuseV1Options.WasmTrapHandlers]: true,
      });
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: desktopBrand.executableName,
      exe: `${desktopBrand.executableName}.exe`,
      setupExe: desktopBrand.setupExecutableName,
      title: desktopBrand.productName,
      authors: desktopBrand.publisher,
    }),
    new MakerZIP({}, ["darwin"]),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
        {
          entry: "src/utility/app-service.ts",
          config: "vite.app-service.config.mts",
          target: "main",
        },
        {
          entry: "src/utility/pi-host.ts",
          config: "vite.pi-host.config.mts",
          target: "main",
        },
        {
          entry: "src/utility/remote-host.ts",
          config: "vite.remote-host.config.mts",
          target: "main",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
  ],
};

export default config;
