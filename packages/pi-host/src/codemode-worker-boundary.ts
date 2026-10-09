export const nativeWorkerOutputLimits = { bytes: 64 * 1024, messages: 4_096 } as const;
export const nativeWorkerCallLimits = {
  tools: 64,
  globals: 128,
  argumentBytes: 1024 * 1024,
} as const;

/** Bound data before a worker sends it to the host's native output collector. */
export function createNativeWorkerOutputBoundary(
  send: (message: unknown) => void,
  interrupt: () => void,
): (message: unknown) => boolean {
  let bytes = 0;
  let messages = 0;
  let toolCalls = 0;
  let globalCalls = 0;
  let ended = false;
  return (message) => {
    if (ended) return false;
    const record =
      message && typeof message === "object" ? (message as Record<string, unknown>) : undefined;
    let limitCode: string | undefined;
    if (record?.type === "call") {
      if (record.target === "tool" && ++toolCalls > nativeWorkerCallLimits.tools) {
        limitCode = "PI_NATIVE_TOOL_CALL_LIMIT";
      }
      if (record.target === "global" && ++globalCalls > nativeWorkerCallLimits.globals) {
        limitCode = "PI_NATIVE_GLOBAL_CALL_LIMIT";
      }
      if (
        typeof record.args === "string" &&
        Buffer.byteLength(record.args, "utf8") > nativeWorkerCallLimits.argumentBytes
      ) {
        limitCode = "PI_NATIVE_ARGUMENT_LIMIT";
      }
    } else if (record?.type === "output") {
      messages += 1;
      bytes += Buffer.byteLength(JSON.stringify(record.item) ?? "", "utf8");
    } else if (record?.type === "done" && record.ok === true && typeof record.value === "string") {
      // A top-level return is appended as script output by the native executor.
      bytes += Buffer.byteLength(record.value, "utf8");
    } else if (record?.type === "done" && record.ok === false && typeof record.error === "string") {
      bytes += Buffer.byteLength(record.error, "utf8");
    } else if (record?.type === "crash" && typeof record.message === "string") {
      bytes += Buffer.byteLength(record.message, "utf8");
    }
    if (bytes > nativeWorkerOutputLimits.bytes || messages > nativeWorkerOutputLimits.messages) {
      limitCode = "PI_NATIVE_OUTPUT_LIMIT";
    }
    if (limitCode) {
      ended = true;
      send({
        type: "done",
        ok: false,
        error: JSON.stringify({
          name: "Error",
          message: `${limitCode}: script exceeded the worker boundary`,
        }),
      });
      interrupt();
      return false;
    }
    return true;
  };
}
