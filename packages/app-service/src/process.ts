import path from "node:path";
import {
  appServiceBootstrapSchema,
  appServiceRequestFrameSchema,
  type ErrorEnvelope,
  safeErrorMessage,
} from "@openerx/contracts";
import { FileAppService } from "@openerx/file-service";
import { ChatRepository, FileRepository } from "@openerx/storage";
import type { MessagePortMain } from "electron";
import { ChatAppService } from "./chat-app-service";
import { MessagePortPiHostClient } from "./pi-host-client";
import { HttpAccountSyncTransport, SyncCoordinator } from "./sync-coordinator";

const parentPort = process.parentPort;
if (!parentPort) throw new Error("App Service requires an Electron utility-process parent port");

parentPort.once("message", async (bootstrapEvent) => {
  const bootstrap = appServiceBootstrapSchema.parse(bootstrapEvent.data);
  const [mainPort, piHostPort] = bootstrapEvent.ports as MessagePortMain[];
  if (!mainPort || !piHostPort) throw new Error("App Service bootstrap ports are missing");

  const piHost = new MessagePortPiHostClient(piHostPort, bootstrap.piHostNonce);
  await piHost.ready();
  const repository = new ChatRepository(
    path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"),
    {
      ownerProfileId: bootstrap.ownerProfileId,
      selectedModelRef: "platform/auto",
      deviceId: bootstrap.deviceId,
    },
  );
  const fileRepository = new FileRepository(
    path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"),
    { ownerProfileId: bootstrap.ownerProfileId, deviceId: bootstrap.deviceId },
  );
  const files = new FileAppService(fileRepository, bootstrap.profileDirectory);
  const service = new ChatAppService(
    repository,
    piHost,
    new SyncCoordinator(repository, new HttpAccountSyncTransport(), files),
    files,
  );
  service.onEvent((event) => mainPort.postMessage({ kind: "app-service.event", event }));
  service.initialize();

  mainPort.on("message", async (event) => {
    const request = appServiceRequestFrameSchema.safeParse(event.data);
    if (!request.success) return;
    try {
      const data = await service.handle(request.data.request, request.data.authorization);
      mainPort.postMessage({
        kind: "app-service.response",
        requestId: request.data.requestId,
        ok: true,
        data,
      });
    } catch (error) {
      const envelope: ErrorEnvelope = {
        code: "APP_SERVICE_ERROR",
        message: safeErrorMessage(error, "Unknown App Service error"),
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
