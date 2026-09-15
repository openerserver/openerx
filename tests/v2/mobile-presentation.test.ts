import type { RemoteProductEvent } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import {
  mergeRemoteEvents,
  mobileErrorMessage,
  pendingAttention,
  remoteTasks,
} from "../../apps/mobile/src/presentation";
import type { DecryptedRemoteEvent } from "../../apps/mobile/src/remote-controller";

function event(
  kind: RemoteProductEvent["kind"],
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): DecryptedRemoteEvent {
  return {
    envelope: {
      version: 1,
      eventId: id,
      accountId: "account",
      hostDeviceId: "host",
      conversationId: "task",
      cursor: id,
      kind,
      occurredAt: new Date().toISOString(),
      encryptedPayload: "encrypted",
    },
    payload,
  };
}

describe("mobile task presentation", () => {
  it("shows a user-requested interruption as stopped instead of a model failure", () => {
    const task = remoteTasks([
      event("message.delta", { messageId: "assistant", delta: "working" }),
      event("message.cancelling", { messageId: "assistant" }),
      event("message.interrupted", { messageId: "assistant" }),
    ])[0];
    expect(task).toMatchObject({ status: "stopped", activeMessageId: null });
    expect(task?.messages[0]?.status).toBe("stopped");
  });

  it("deduplicates polling, reconciles final text, and puts a late user acknowledgement before its answer", () => {
    const delta = event("message.delta", { messageId: "assistant", delta: "初稿" });
    const merged = mergeRemoteEvents(
      [delta],
      [
        delta,
        event("message.completed", {
          message: { id: "assistant", role: "assistant", text: "完整结果", status: "completed" },
        }),
        event("conversation.updated", {
          commandStatus: "applied",
          userMessage: { id: "user", text: "请总结" },
          assistantMessageId: "assistant",
        }),
      ],
    );
    const task = remoteTasks(merged)[0];
    expect(task).toMatchObject({ title: "请总结", status: "completed", activeMessageId: null });
    expect(task?.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "请总结" },
      { role: "assistant", text: "完整结果" },
    ]);
  });

  it.each(["failed", "stopped", "interrupted"] as const)(
    "does not offer stop or steer after a %s response",
    (status) => {
      const task = remoteTasks([
        event("message.delta", { messageId: "assistant", delta: "部分结果" }),
        event(`message.${status}`, { messageId: "assistant", reason: "PLATFORM_MODEL_NOT_FOUND" }),
      ])[0];
      expect(task?.activeMessageId).toBeNull();
      expect(task?.status).toBe(status === "stopped" ? "stopped" : "failed");
      expect(mobileErrorMessage(task?.messages[0]?.reason)).toContain("模型设置");
    },
  );

  it("only offers unresolved, unexpired approval requests and preserves the active task", () => {
    const request = event("attention.requested", {
      permissionRequestId: "p",
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    const events = [event("message.delta", { messageId: "assistant", delta: "" }), request];
    expect(remoteTasks(events)[0]).toMatchObject({
      status: "waiting",
      activeMessageId: "assistant",
    });
    expect(pendingAttention(events)).toEqual([request]);
    const resolved = [...events, event("attention.resolved", { permissionRequestId: "p" })];
    expect(pendingAttention(resolved)).toEqual([]);
    expect(remoteTasks(resolved)[0]?.status).toBe("running");
    expect(
      pendingAttention([
        event("attention.requested", {
          permissionRequestId: "expired",
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        }),
      ]),
    ).toEqual([]);
  });

  it("does not expose unknown internal errors or credentials as user-facing copy", () => {
    expect(mobileErrorMessage(new Error("INTERNAL_MODEL_ERROR: sk-private-key"))).not.toContain(
      "sk-private-key",
    );
    expect(mobileErrorMessage("CHALLENGE_CODE_INVALID")).toContain("验证码不正确");
    expect(mobileErrorMessage("BYOK_API_KEY_REQUIRED")).toContain("设置 → 模型");
  });
});
