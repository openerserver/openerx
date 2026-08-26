import type { ChatEvent } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { projectChatEventForRemote } from "../src";

describe("remote event projection", () => {
  it("keeps only the stable product fields needed by the mobile control plane", () => {
    const event: ChatEvent = {
      eventId: "00000000-0000-4000-8000-000000000101",
      type: "message.delta",
      conversationId: "00000000-0000-4000-8000-000000000102",
      messageId: "00000000-0000-4000-8000-000000000103",
      sequence: 3,
      occurredAt: "2026-08-26T09:00:00.000Z",
      payloadVersion: 1,
      payload: { delta: "safe delta" },
    };

    expect(projectChatEventForRemote(event)).toEqual({
      kind: "message.delta",
      conversationId: event.conversationId,
      occurredAt: event.occurredAt,
      payload: {
        eventId: event.eventId,
        type: event.type,
        conversationId: event.conversationId,
        messageId: event.messageId,
        sequence: event.sequence,
        delta: "safe delta",
      },
    });
  });

  it("does not route service diagnostics as remote product events", () => {
    expect(
      projectChatEventForRemote({
        eventId: "00000000-0000-4000-8000-000000000104",
        type: "service.status",
        conversationId: null,
        messageId: null,
        sequence: 0,
        occurredAt: "2026-08-26T09:00:00.000Z",
        payloadVersion: 1,
        payload: { status: "ready" },
      }),
    ).toBeNull();
  });
});
