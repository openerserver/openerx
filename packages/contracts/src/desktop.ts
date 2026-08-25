import { z } from "zod";

export const ipcChannels = Object.freeze({
  environmentGet: "desktop:environment:get",
});

export const desktopEnvironmentSchema = z
  .object({
    platform: z.enum(["darwin", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    appVersion: z.string().min(1),
  })
  .strict();

export type DesktopEnvironment = z.infer<typeof desktopEnvironmentSchema>;

export interface DesktopBridge {
  getEnvironment(): Promise<DesktopEnvironment>;
}
