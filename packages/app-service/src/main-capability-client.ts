import { randomUUID } from "node:crypto";
import {
  mainCapabilityResponseFrameSchema,
  mainCredentialResponseFrameSchema,
  type NormalizedToolResult,
  type ToolOperation,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";

interface PendingRequest {
  resolve(result: NormalizedToolResult): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
  abort(): void;
}

export class MainCapabilityClient {
  readonly #pending = new Map<string, PendingRequest>();
  readonly #pendingCredentials = new Map<
    string,
    {
      resolve(value: string | undefined): void;
      reject(error: Error): void;
      timeout: NodeJS.Timeout;
    }
  >();
  constructor(private readonly port: MessagePortMain) {}

  async execute(operation: ToolOperation, signal: AbortSignal): Promise<NormalizedToolResult> {
    const requestId = randomUUID();
    return await new Promise((resolve, reject) => {
      const abort = () => {
        this.port.postMessage({ kind: "main.capability.cancel", requestId });
        this.#finish(requestId, () => reject(new Error("TOOL_CANCELLED")));
      };
      const timeout = setTimeout(() => {
        this.port.postMessage({ kind: "main.capability.cancel", requestId });
        this.#finish(requestId, () => reject(new Error("MAIN_CAPABILITY_TIMEOUT")));
      }, 60_000);
      this.#pending.set(requestId, {
        resolve,
        reject,
        timeout,
        abort: () => signal.removeEventListener("abort", abort),
      });
      signal.addEventListener("abort", abort, { once: true });
      this.port.postMessage({ kind: "main.capability.request", requestId, operation });
    });
  }

  handleMessage(data: unknown): boolean {
    const response = mainCapabilityResponseFrameSchema.safeParse(data);
    if (!response.success) {
      const credential = mainCredentialResponseFrameSchema.safeParse(data);
      if (!credential.success) return false;
      const pendingCredential = this.#pendingCredentials.get(credential.data.requestId);
      if (!pendingCredential) return true;
      clearTimeout(pendingCredential.timeout);
      this.#pendingCredentials.delete(credential.data.requestId);
      if (credential.data.ok) pendingCredential.resolve(credential.data.value);
      else pendingCredential.reject(new Error(credential.data.errorCode));
      return true;
    }
    const pending = this.#pending.get(response.data.requestId);
    if (!pending) return true;
    this.#finish(response.data.requestId, () => {
      if (response.data.ok) pending.resolve(response.data.data);
      else pending.reject(new Error(response.data.errorCode));
    });
    return true;
  }

  close(): void {
    for (const [requestId, pending] of this.#pending) {
      this.#finish(requestId, () => pending.reject(new Error("MAIN_CAPABILITY_HOST_STOPPED")));
    }
    for (const [requestId, pending] of this.#pendingCredentials) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MAIN_CREDENTIAL_HOST_STOPPED"));
      this.#pendingCredentials.delete(requestId);
    }
  }

  async resolve(credentialRef: string): Promise<string> {
    const value = await this.#credentialRequest("resolve", credentialRef);
    if (!value) throw new Error("MCP_CREDENTIAL_NOT_FOUND");
    return value;
  }

  async clear(credentialRef: string): Promise<void> {
    await this.#credentialRequest("clear", credentialRef);
  }

  #finish(requestId: string, complete: () => void): void {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.abort();
    this.#pending.delete(requestId);
    complete();
  }

  async #credentialRequest(
    operation: "resolve" | "clear",
    credentialRef: string,
  ): Promise<string | undefined> {
    const requestId = randomUUID();
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingCredentials.delete(requestId);
        reject(new Error("MAIN_CREDENTIAL_TIMEOUT"));
      }, 15_000);
      this.#pendingCredentials.set(requestId, { resolve, reject, timeout });
      this.port.postMessage({
        kind: "main.credential.request",
        requestId,
        operation,
        credentialRef,
      });
    });
  }
}
