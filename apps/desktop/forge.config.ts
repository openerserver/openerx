import path from "node:path";
import { FuseV1Options, FuseVersion, flipFuses } from "@electron/fuses";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: "openerx",
    name: "OpenerX",
  },
  hooks: {
    packageAfterCopy: async (forgeConfig, buildPath, _electronVersion, platform, arch) => {
      const appBasePath = path.resolve(buildPath, "../..");
      const executablePath = ["darwin", "mas"].includes(platform)
        ? path.join(appBasePath, "MacOS", "Electron")
        : path.join(appBasePath, platform === "win32" ? "electron.exe" : "electron");
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
