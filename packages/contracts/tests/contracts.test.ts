import { describe, expect, it } from "vitest";
import {
  appServiceBootstrapSchema,
  chatCommandEnvelopeSchema,
  desktopEnvironmentSchema,
  errorEnvelopeSchema,
  parseChatCommandResult,
  piHostEventFrameSchema,
} from "../src";

describe("desktop environment contract", () => {
  it("accepts supported V1 targets", () => {
    expect(
      desktopEnvironmentSchema.parse({
        platform: "darwin",
        arch: "arm64",
        appVersion: "2.0.0-alpha.0",
      }),
    ).toEqual({
      platform: "darwin",
      arch: "arm64",
      appVersion: "2.0.0-alpha.0",
    });
  });

  it("rejects unsupported platforms and unknown fields", () => {
    expect(() =>
      desktopEnvironmentSchema.parse({
        platform: "linux",
        arch: "x64",
        appVersion: "2.0.0-alpha.0",
      }),
    ).toThrow();

    expect(() =>
      desktopEnvironmentSchema.parse({
        platform: "win32",
        arch: "x64",
        appVersion: "2.0.0-alpha.0",
        nodeIntegration: true,
      }),
    ).toThrow();
  });
});

describe("error envelope contract", () => {
  it("requires stable codes and correlation IDs", () => {
    expect(
      errorEnvelopeSchema.parse({
        code: "IPC_SENDER_REJECTED",
        message: "Sender is not trusted",
        correlationId: "corr_01",
        retryable: false,
      }),
    ).toMatchObject({ code: "IPC_SENDER_REJECTED", retryable: false });
  });

  it("rejects informal error codes", () => {
    expect(() =>
      errorEnvelopeSchema.parse({
        code: "ipc sender rejected",
        message: "Sender is not trusted",
        correlationId: "corr_01",
        retryable: false,
      }),
    ).toThrow();
  });
});

describe("M1 process and chat contracts", () => {
  it("rejects unknown chat fields and weak mutation idempotency keys", () => {
    expect(() =>
      chatCommandEnvelopeSchema.parse({
        command: "chat.send",
        input: { text: "hello", idempotencyKey: "short", executable: "rm" },
      }),
    ).toThrow();
  });

  it("requires exact process versions and 256-bit boot nonces", () => {
    const nonce = "a".repeat(64);
    expect(
      appServiceBootstrapSchema.parse({
        kind: "app-service.bootstrap",
        contractVersion: 1,
        nonce,
        piHostNonce: nonce,
        profileDirectory: "/profile",
      }),
    ).toMatchObject({ contractVersion: 1 });
    expect(() =>
      appServiceBootstrapSchema.parse({
        kind: "app-service.bootstrap",
        contractVersion: 2,
        nonce: "weak",
        piHostNonce: nonce,
        profileDirectory: "/profile",
      }),
    ).toThrow();
  });

  it("rejects malformed Pi Host events and malformed command responses", () => {
    expect(() =>
      piHostEventFrameSchema.parse({
        kind: "pi.product-event",
        generationId: crypto.randomUUID(),
        eventId: crypto.randomUUID(),
        sequence: 0,
        occurredAt: "not-a-date",
        type: "delta",
        delta: 42,
      }),
    ).toThrow();
    expect(() => parseChatCommandResult("chat.list", [{ title: "incomplete" }])).toThrow();
  });
});
