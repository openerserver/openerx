export interface DesktopBrandColors {
  accent: string;
  accentStrong: string;
  accentHover: string;
  accentSoft: string;
}

export interface DesktopBrand {
  schemaVersion: 1;
  id: string;
  productName: string;
  displayName: string;
  assistantName: string;
  assistantTitle: string;
  description: string;
  appBundleId: string;
  executableName: string;
  setupExecutableName: string;
  publisher: string;
  workspaceDirectoryName: string;
  markText: string;
  logoAlt: string;
  colors: DesktopBrandColors;
  logoDataUrl: string | null;
  assistantImageDataUrl: string | null;
}

export const openERXBrand: DesktopBrand = {
  schemaVersion: 1,
  id: "openerx",
  productName: "OpenERX",
  displayName: "OpenERX Personal AI",
  assistantName: "OpenERX",
  assistantTitle: "OpenERX 工作助手",
  description: "OpenERX personal AI desktop client",
  appBundleId: "com.openerx.desktop",
  executableName: "OpenERX",
  setupExecutableName: "OpenERXSetup.exe",
  publisher: "OpenERX",
  workspaceDirectoryName: "OpenERX Workspace",
  markText: "OX",
  logoAlt: "OpenERX 标志",
  colors: {
    accent: "#6366f1",
    accentStrong: "#818cf8",
    accentHover: "#7c3aed",
    accentSoft: "#6366f124",
  },
  logoDataUrl: null,
  assistantImageDataUrl: null,
};

declare const __OPENERX_BRAND__: DesktopBrand;

export const desktopBrand: DesktopBrand =
  typeof __OPENERX_BRAND__ === "undefined" ? openERXBrand : __OPENERX_BRAND__;
