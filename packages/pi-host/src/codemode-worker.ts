import { parentPort, workerData } from "node:worker_threads";
import { createNativeWorkerOutputBoundary } from "./codemode-worker-boundary";

// Install only a transport boundary. The official worker still owns QuickJS and execution.
if (parentPort) {
  const port = parentPort;
  const send = port.postMessage.bind(port);
  const record =
    workerData && typeof workerData === "object"
      ? (workerData as Record<string, unknown>)
      : undefined;
  const interrupt =
    record?.interrupt instanceof SharedArrayBuffer ? new Int32Array(record.interrupt) : undefined;
  const allow = createNativeWorkerOutputBoundary(send, () => {
    if (interrupt && interrupt.length > 0) Atomics.store(interrupt, 0, 1);
  });
  port.postMessage = (message, transferList) => {
    if (!allow(message)) return;
    if (Array.isArray(transferList)) send(message, transferList);
    else send(message, transferList);
  };
}

// The boundary must be installed before the official module starts its worker.
void import("@earendil-works/pi-codemode/worker").catch((error: unknown) => {
  parentPort?.postMessage({
    type: "crash",
    message: error instanceof Error ? error.message : "PI_NATIVE_WORKER_START_FAILED",
  });
});
