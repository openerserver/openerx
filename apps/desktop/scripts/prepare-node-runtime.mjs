import { prepareNodeRuntime } from "./managed-node-runtime.mjs";

const platform = process.argv[2] ?? process.platform;
const architecture = process.argv[3] ?? process.arch;
const directory = await prepareNodeRuntime({
  platform,
  architecture,
  offline: process.env.OPENERX_RUNTIME_OFFLINE === "1",
});
process.stdout.write(`Verified Node/npm runtime: ${directory}\n`);
