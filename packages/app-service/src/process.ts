import path from "node:path";
import {
  appServiceBootstrapSchema,
  appServiceRequestFrameSchema,
  type ErrorEnvelope,
} from "@openerx/contracts";
import { ChatRepository } from "@openerx/storage";
import type { MessagePortMain } from "electron";
import { ChatAppService } from "./chat-app-service";
import { MessagePortPiHostClient } from "./pi-host-client";

const parentPort = process.parentPort;
if (!parentPort) throw new Error("App Service requires an Electron utility-process parent port");

parentPort.once("message", async (bootstrapEvent) => {
  const bootstrap = appServiceBootstrapSchema.parse(bootstrapEvent.data);
  const [mainPort, piHostPort] = bootstrapEvent.ports as MessagePortMain[];
  if (!mainPort || !piHostPort) throw new Error("App Service bootstrap ports are missing");

  const piHost = new MessagePortPiHostClient(piHostPort, bootstrap.piHostNonce);
  await piHost.ready();
  const repository = new ChatRepository(path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"));
  const service = new ChatAppService(repository, piHost);
  service.onEvent((event) => mainPort.postMessage({ kind: "app-service.event", event }));
  service.initialize();

  mainPort.on("message", async (event) => {
    const request = appServiceRequestFrameSchema.safeParse(event.data);
    if (!request.success) return;
    try {
      const data = await service.handle(request.data.request);
      mainPort.postMessage({
        kind: "app-service.response",
        requestId: request.data.requestId,
        ok: true,
        data,
      });
    } catch (error) {
      const envelope: ErrorEnvelope = {
        code: "APP_SERVICE_ERROR",
        message: error instanceof Error ? error.message : "Unknown App Service error",
        correlationId: request.data.requestId,
        retryable: false,
      };
      mainPort.postMessage({
        kind: "app-service.response",
        requestId: request.data.requestId,
        ok: false,
        error: envelope,
      });
    }
  });
  mainPort.start();
  mainPort.postMessage({
    kind: "app-service.ready",
    contractVersion: 1,
    nonce: bootstrap.nonce,
  });
  process.once("exit", () => service.close());
});
