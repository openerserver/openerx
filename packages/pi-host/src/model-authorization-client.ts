import { randomUUID } from "node:crypto";
import { type ModelAuthorization, modelAuthorizationResponseSchema } from "@openerx/contracts";

type Port = { postMessage(value: unknown): void };
export class ModelAuthorizationClient {
  readonly #pending = new Map<
    string,
    {
      resolve(value: ModelAuthorization): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private readonly port: Port) {}
  authorize(accountId: string, rejectedAccessToken?: string): Promise<ModelAuthorization> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error("MODEL_AUTHORIZATION_TIMEOUT"));
      }, 20_000);
      this.#pending.set(requestId, { resolve, reject, timer });
      this.port.postMessage({
        kind: "model.authorization.request",
        requestId,
        accountId,
        ...(rejectedAccessToken ? { rejectedAccessToken } : {}),
      });
    });
  }
  handle(data: unknown): boolean {
    const result = modelAuthorizationResponseSchema.safeParse(data);
    if (!result.success) return false;
    const pending = this.#pending.get(result.data.requestId);
    if (!pending) return true;
    clearTimeout(pending.timer);
    this.#pending.delete(result.data.requestId);
    if (result.data.ok) pending.resolve(result.data.authorization);
    else pending.reject(new Error(result.data.errorCode));
    return true;
  }
  close(): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("PI_HOST_DISCONNECTED"));
    }
    this.#pending.clear();
  }
}
