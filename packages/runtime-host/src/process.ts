import {
  type RuntimeStartFrame,
  runtimeBootstrapSchema,
  runtimeRequestFrameSchema,
} from "@openerx/contracts";
import { FakeRuntimeAdapter, type RuntimeHandle } from "@openerx/runtime-sdk";
import type { MessagePortMain } from "electron";

const parentPort = process.parentPort;
if (!parentPort) throw new Error("Runtime Host requires an Electron utility-process parent port");

parentPort.once("message", (bootstrapEvent) => {
  const bootstrap = runtimeBootstrapSchema.parse(bootstrapEvent.data);
  const [port] = bootstrapEvent.ports as MessagePortMain[];
  if (!port) throw new Error("Runtime Host bootstrap port is missing");
  const adapter = new FakeRuntimeAdapter();
  const handles = new Map<string, RuntimeHandle>();

  const start = async (frame: RuntimeStartFrame): Promise<void> => {
    try {
      const handle = await adapter.start({ conversationId: frame.conversationId });
      handles.set(frame.generationId, handle);
      await adapter.send(handle, {
        assistantMessageId: frame.assistantMessageId,
        history: frame.history,
      });
      for await (const event of adapter.stream(handle)) {
        port.postMessage({
          kind: "runtime.event",
          generationId: frame.generationId,
          ...event,
        });
      }
      await adapter.dispose(handle);
      handles.delete(frame.generationId);
    } catch {
      port.postMessage({
        kind: "runtime.event",
        generationId: frame.generationId,
        eventId: crypto.randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "failed",
        errorCode: "RUNTIME_HOST_FAILURE",
      });
    }
  };

  port.on("message", (event) => {
    const request = runtimeRequestFrameSchema.safeParse(event.data);
    if (!request.success) return;
    if (request.data.kind === "runtime.start") {
      void start(request.data);
      return;
    }
    const handle = handles.get(request.data.generationId);
    if (handle) void adapter.stop(handle);
  });
  port.start();
  port.postMessage({
    kind: "runtime.ready",
    contractVersion: 1,
    nonce: bootstrap.nonce,
  });
});
