import { randomUUID } from "node:crypto";
import {
  type AutomationExecutionContext,
  type DesktopExecutionContext,
  type HostToolAvailability,
  type MainOAuthResponseFrame,
  mainAutomationContextResponseFrameSchema,
  mainCapabilityAvailabilityResponseFrameSchema,
  mainCapabilityResponseFrameSchema,
  mainCredentialResponseFrameSchema,
  mainOAuthResponseFrameSchema,
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
  readonly #pendingAvailability = new Map<
    string,
    {
      resolve(value: HostToolAvailability): void;
      reject(error: Error): void;
      timeout: NodeJS.Timeout;
    }
  >();
  readonly #pendingAutomationContexts = new Map<
    string,
    {
      resolve(value: AutomationExecutionContext): void;
      reject(error: Error): void;
      timeout: NodeJS.Timeout;
    }
  >();
  readonly #pendingOAuth = new Map<
    string,
    {
      resolve(value: MainOAuthResponseFrame): void;
      reject(error: Error): void;
      timeout: NodeJS.Timeout;
    }
  >();
  constructor(private readonly port: MessagePortMain) {}

  async execute(
    operation: ToolOperation,
    signal: AbortSignal,
    executionContext?: DesktopExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (signal.aborted) throw new Error("TOOL_CANCELLED");
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
      this.port.postMessage({
        kind: "main.capability.request",
        requestId,
        operation,
        ...(executionContext ? { executionContext } : {}),
      });
    });
  }

  async availability(): Promise<HostToolAvailability> {
    const requestId = randomUUID();
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingAvailability.delete(requestId);
        reject(new Error("MAIN_CAPABILITY_AVAILABILITY_TIMEOUT"));
      }, 15_000);
      this.#pendingAvailability.set(requestId, { resolve, reject, timeout });
      this.port.postMessage({ kind: "main.capability.availability.request", requestId });
    });
  }

  handleMessage(data: unknown): boolean {
    const automationContext = mainAutomationContextResponseFrameSchema.safeParse(data);
    if (automationContext.success) {
      const pending = this.#pendingAutomationContexts.get(automationContext.data.requestId);
      if (!pending) return true;
      clearTimeout(pending.timeout);
      this.#pendingAutomationContexts.delete(automationContext.data.requestId);
      if (automationContext.data.ok) pending.resolve(automationContext.data.data);
      else pending.reject(new Error(automationContext.data.errorCode));
      return true;
    }
    const response = mainCapabilityResponseFrameSchema.safeParse(data);
    if (!response.success) {
      const availability = mainCapabilityAvailabilityResponseFrameSchema.safeParse(data);
      if (availability.success) {
        const pendingAvailability = this.#pendingAvailability.get(availability.data.requestId);
        if (!pendingAvailability) return true;
        clearTimeout(pendingAvailability.timeout);
        this.#pendingAvailability.delete(availability.data.requestId);
        if (availability.data.ok) pendingAvailability.resolve(availability.data.data);
        else pendingAvailability.reject(new Error(availability.data.errorCode));
        return true;
      }
      const credential = mainCredentialResponseFrameSchema.safeParse(data);
      if (!credential.success) {
        const oauth = mainOAuthResponseFrameSchema.safeParse(data);
        if (!oauth.success) return false;
        const pendingOAuth = this.#pendingOAuth.get(oauth.data.requestId);
        if (!pendingOAuth) return true;
        clearTimeout(pendingOAuth.timeout);
        this.#pendingOAuth.delete(oauth.data.requestId);
        if (oauth.data.ok) pendingOAuth.resolve(oauth.data);
        else pendingOAuth.reject(new Error(oauth.data.errorCode));
        return true;
      }
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
    for (const [requestId, pending] of this.#pendingAvailability) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MAIN_CAPABILITY_HOST_STOPPED"));
      this.#pendingAvailability.delete(requestId);
    }
    for (const [requestId, pending] of this.#pendingOAuth) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MAIN_OAUTH_HOST_STOPPED"));
      this.#pendingOAuth.delete(requestId);
    }
    for (const [requestId, pending] of this.#pendingAutomationContexts) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MAIN_AUTOMATION_CONTEXT_HOST_STOPPED"));
      this.#pendingAutomationContexts.delete(requestId);
    }
  }

  async automationExecutionContext(modelRef?: string): Promise<AutomationExecutionContext> {
    const requestId = randomUUID();
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingAutomationContexts.delete(requestId);
        reject(new Error("MAIN_AUTOMATION_CONTEXT_TIMEOUT"));
      }, 15_000);
      this.#pendingAutomationContexts.set(requestId, { resolve, reject, timeout });
      this.port.postMessage({
        kind: "main.automation-context.request",
        requestId,
        ...(modelRef ? { modelRef } : {}),
      });
    });
  }

  async resolve(credentialRef: string): Promise<string> {
    const value = await this.#credentialRequest("resolve", credentialRef);
    if (!value) throw new Error("MCP_CREDENTIAL_NOT_FOUND");
    return value;
  }

  async clear(credentialRef: string): Promise<void> {
    await this.#credentialRequest("clear", credentialRef);
  }

  async save(credentialRef: string, value: string): Promise<void> {
    await this.#credentialRequest("save", credentialRef, value);
  }

  async prepareOAuth(serverId: string): Promise<{ sessionId: string; redirectUrl: string }> {
    const response = await this.#oauthRequest({ operation: "prepare", serverId }, 15_000);
    if (response.operation !== "prepare") throw new Error("MAIN_OAUTH_RESPONSE_MISMATCH");
    return { sessionId: response.sessionId, redirectUrl: response.redirectUrl };
  }

  async waitForOAuthCallback(sessionId: string, authorizationUrl: string): Promise<string> {
    const response = await this.#oauthRequest(
      { operation: "authorize", sessionId, authorizationUrl },
      5 * 60_000,
    );
    if (response.operation !== "authorize") throw new Error("MAIN_OAUTH_RESPONSE_MISMATCH");
    return response.callbackUrl;
  }

  async cancelOAuth(sessionId: string): Promise<void> {
    const response = await this.#oauthRequest({ operation: "cancel", sessionId }, 15_000);
    if (response.operation !== "cancel") throw new Error("MAIN_OAUTH_RESPONSE_MISMATCH");
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
    operation: "resolve" | "clear" | "save",
    credentialRef: string,
    value?: string,
  ): Promise<string | undefined> {
    if (operation === "save" && value === undefined) {
      throw new Error("MAIN_CREDENTIAL_VALUE_REQUIRED");
    }
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
        ...(operation === "save" ? { value } : {}),
      });
    });
  }

  async #oauthRequest(
    input:
      | { operation: "prepare"; serverId: string }
      | { operation: "authorize"; sessionId: string; authorizationUrl: string }
      | { operation: "cancel"; sessionId: string },
    timeoutMs: number,
  ): Promise<Extract<MainOAuthResponseFrame, { ok: true }>> {
    const requestId = randomUUID();
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingOAuth.delete(requestId);
        reject(new Error("MAIN_OAUTH_TIMEOUT"));
      }, timeoutMs);
      this.#pendingOAuth.set(requestId, {
        resolve: (response) => {
          if (!response.ok) {
            reject(new Error(response.errorCode));
            return;
          }
          resolve(response);
        },
        reject,
        timeout,
      });
      this.port.postMessage({ kind: "main.oauth.request", requestId, ...input });
    });
  }
}
