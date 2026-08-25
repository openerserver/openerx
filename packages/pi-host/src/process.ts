import { startPiHostProcess } from "./host";

const parentPort = process.parentPort;
if (!parentPort) throw new Error("Pi Host requires an Electron utility-process parent port");

startPiHostProcess(parentPort);
