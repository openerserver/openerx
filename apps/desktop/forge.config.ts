import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FuseV1Options, FuseVersion, flipFuses } from "@electron/fuses";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { releaseUpdateConfigurationSchema } from "@openerx/contracts";

const releaseMode = process.env.OPENERX_RELEASE_MODE === "1";

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
  if (!releaseMode) return {};
  if (process.platform === "darwin") {
    return {
      osxSign: { identity: requiredEnvironment("OPENERX_MAC_SIGN_IDENTITY") },
      osxNotarize: {
        appleApiKey: requiredEnvironment("APPLE_API_KEY"),
        appleApiKeyId: requiredEnvironment("APPLE_API_KEY_ID"),
        appleApiIssuer: requiredEnvironment("APPLE_API_ISSUER"),
      },
    };
  }
  if (process.platform === "win32") {
    return {
      windowsSign: {
        certificateFile: requiredEnvironment("WINDOWS_CERTIFICATE_FILE"),
        certificatePassword: requiredEnvironment("WINDOWS_CERTIFICATE_PASSWORD"),
        description: "OpenerX personal AI desktop client",
        website: "https://openerx.example",
      },
    };
  }
  throw new Error("RELEASE_HOST_PLATFORM_UNSUPPORTED");
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: "com.openerx.desktop",
    appCategoryType: "public.app-category-type.productivity",
    appCopyright: "Copyright © 2026 OpenerX",
    executableName: "OpenerX",
    name: "OpenerX",
    ...signingConfiguration(),
  },
  hooks: {
    packageAfterCopy: async (forgeConfig, buildPath, _electronVersion, platform, arch) => {
      const releaseDirectory = path.join(buildPath, "release");
      mkdirSync(releaseDirectory, { recursive: true });
      writeFileSync(
        path.join(releaseDirectory, "update-config.json"),
        `${JSON.stringify(updateConfiguration(), null, 2)}\n`,
        { mode: 0o644 },
      );
      const appBasePath = path.resolve(buildPath, "../..");
      const executablePath = ["darwin", "mas"].includes(platform)
        ? path.join(appBasePath, "MacOS", "OpenerX")
        : path.join(appBasePath, platform === "win32" ? "electron.exe" : "OpenerX");
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
  makers: [new MakerSquirrel({}), new MakerZIP({}, ["darwin"]), new MakerDMG({})],
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
