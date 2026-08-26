import path from "node:path";
import {
  type RemoteApplyCommandRequestFrame,
  type RemoteApplyCommandResponseFrame,
  type RemoteCommand,
  type RemoteCommandPayload,
  remoteApplyCommandResponseFrameSchema,
  remoteConnectorBootstrapSchema,
  remoteConnectorConfigureFrameSchema,
  remoteConnectorDisableFrameSchema,
  remoteLocalEventFrameSchema,
  remoteRevisionResponseFrameSchema,
} from "@openerx/contracts";
import { HttpRemoteGatewayTransport, RemoteHostConnector } from "@openerx/remote-host";
import type { MessagePortMain } from "electron";

const parentPort = process.parentPort;
if (!parentPort)
  throw new Error("Remote Connector requires an Electron utility-process parent port");

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

parentPort.once("message", (bootstrapEvent) => {
  const bootstrap = remoteConnectorBootstrapSchema.parse(bootstrapEvent.data);
  const [appServicePort] = bootstrapEvent.ports as MessagePortMain[];
  if (!appServicePort) throw new Error("Remote Connector AppService port is missing");

  const pendingRevisions = new Map<string, PendingRequest<number>>();
  const pendingCommands = new Map<string, PendingRequest<RemoteApplyCommandResponseFrame>>();
  let connector: RemoteHostConnector | null = null;
  let runController: AbortController | null = null;

  const requestRevision = (conversationId: string | null): Promise<number> => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRevisions.delete(requestId);
        reject(new Error("REMOTE_REVISION_TIMEOUT"));
      }, 10_000);
      pendingRevisions.set(requestId, { resolve, reject, timeout });
      appServicePort.postMessage({
        kind: "remote.revision.request",
        requestId,
        conversationId,
      });
    });
  };

  const applyCommand = (
    command: RemoteCommand,
    payload: RemoteCommandPayload,
  ): Promise<RemoteApplyCommandResponseFrame> => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingCommands.delete(requestId);
        reject(new Error("REMOTE_APPLY_TIMEOUT"));
      }, 30_000);
      pendingCommands.set(requestId, { resolve, reject, timeout });
      const frame: RemoteApplyCommandRequestFrame = {
        kind: "remote.command.apply",
        requestId,
        command,
        payload,
      };
      appServicePort.postMessage(frame);
    });
  };

  const stopConnector = async (): Promise<void> => {
    runController?.abort();
    runController = null;
    const previous = connector;
    connector = null;
    if (!previous) return;
    await previous.stop();
    previous.close();
  };

  appServicePort.on("message", async (event) => {
    const revision = remoteRevisionResponseFrameSchema.safeParse(event.data);
    if (revision.success) {
      const pending = pendingRevisions.get(revision.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingRevisions.delete(revision.data.requestId);
      pending.resolve(revision.data.revision);
      return;
    }
    const command = remoteApplyCommandResponseFrameSchema.safeParse(event.data);
    if (command.success) {
      const pending = pendingCommands.get(command.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingCommands.delete(command.data.requestId);
      pending.resolve(command.data);
      return;
    }
    if (remoteConnectorDisableFrameSchema.safeParse(event.data).success) {
      await stopConnector();
      return;
    }
    const configuration = remoteConnectorConfigureFrameSchema.safeParse(event.data);
    if (configuration.success) {
      await stopConnector();
      const transport = new HttpRemoteGatewayTransport(
        configuration.data.authorization.platformBaseUrl,
        configuration.data.authorization.accessToken,
      );
      connector = new RemoteHostConnector({
        databasePath: path.join(configuration.data.profileDirectory, "remote-connector.sqlite"),
        host: configuration.data.host,
        hostPrivateKey: configuration.data.hostPrivateKey,
        transport,
        applier: {
          currentRevision: requestRevision,
          apply: applyCommand,
        },
      });
      runController = new AbortController();
      void connector.run(runController.signal).catch(() => {
        // The Connector owns its retry loop; a terminal setup failure is recovered by reconfiguration.
      });
      return;
    }
    const localEvent = remoteLocalEventFrameSchema.safeParse(event.data);
    if (localEvent.success && connector) {
      await connector.publishEvent({
        kind: localEvent.data.eventKind,
        conversationId: localEvent.data.conversationId,
        occurredAt: localEvent.data.occurredAt,
        payload: localEvent.data.payload,
      });
    }
  });
  appServicePort.start();
  parentPort.postMessage({
    kind: "remote-connector.ready",
    contractVersion: 1,
    nonce: bootstrap.nonce,
  });
  process.once("exit", () => {
    runController?.abort();
    connector?.close();
    for (const pending of [...pendingRevisions.values(), ...pendingCommands.values()]) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("REMOTE_CONNECTOR_STOPPED"));
    }
  });
});
