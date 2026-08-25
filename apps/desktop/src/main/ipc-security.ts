import { type AppServiceReadyFrame, appServiceReadyFrameSchema } from "@openerx/contracts";

export function assertTrustedIpcSender(event: Electron.IpcMainInvokeEvent): void {
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error("IPC request rejected: sender is not the main frame");
  }
}

export function parseInitialAppServiceReady(
  data: unknown,
  expectedNonce: string,
  handshakeComplete: boolean,
): AppServiceReadyFrame | null {
  const ready = appServiceReadyFrameSchema.safeParse(data);
  if (!ready.success) return null;
  if (handshakeComplete) throw new Error("Duplicate App Service handshake");
  if (ready.data.nonce !== expectedNonce) throw new Error("App Service nonce mismatch");
  return ready.data;
}
