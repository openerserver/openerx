import { describe, expect, it } from "vitest";
import { desktopEnvironmentSchema, errorEnvelopeSchema } from "../src";

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
