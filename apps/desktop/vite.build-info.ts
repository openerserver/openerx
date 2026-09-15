import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBuildInfo } from "./scripts/build-info.mjs";
export const buildInfo = getBuildInfo(process.env.OPENERX_VERSION_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
export const buildInfoDefine = { __OPENERX_BUILD_INFO__: JSON.stringify(buildInfo) };
