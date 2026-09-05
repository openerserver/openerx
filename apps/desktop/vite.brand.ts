import { loadDesktopBrand } from "../../packages/branding/src/node";

export const desktopBrand = loadDesktopBrand();

export const desktopBrandDefine = {
  __OPENERX_BRAND__: JSON.stringify(desktopBrand),
};
