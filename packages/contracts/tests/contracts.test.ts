import { describe, expect, it } from "vitest";
import {
  appServiceBootstrapSchema,
  chatCommandEnvelopeSchema,
  desktopEnvironmentSchema,
  errorEnvelopeSchema,
  parseChatCommandResult,
  piHostEventFrameSchema,
  piPromptFrameSchema,
  redactSensitiveText,
  safeErrorMessage,
  skillInstallationSchema,
  skillPackageManifestSchema,
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

  it("redacts credential canaries from structured error text", () => {
    const canaries = [
      "Bearer access-secret-canary-1234567890",
      "refreshCredential=refresh-secret-canary-1234567890",
      "api_key=sk-secret-canary-1234567890",
      "https://example.test/callback?access_token=url-secret-canary-1234567890",
    ];
    for (const canary of canaries) {
      const redacted = safeErrorMessage(new Error(`request failed: ${canary}`), "fallback");
      expect(redacted).toContain("[REDACTED]");
      expect(redacted).not.toContain("secret-canary");
    }
    expect(redactSensitiveText("MODEL_NOT_FOUND")).toBe("MODEL_NOT_FOUND");
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
  it("accepts bounded canonical image data and pending file ids in prompt contracts", () => {
    const personalFileId = crypto.randomUUID();
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "chat.send",
        input: {
          text: "解析图片",
          idempotencyKey: "image-send-contract-0001",
          personalFileIds: [personalFileId],
        },
      }),
    ).toMatchObject({ input: { personalFileIds: [personalFileId] } });
    const baseFrame = {
      kind: "pi.session.prompt" as const,
      generationId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      assistantMessageId: crypto.randomUUID(),
      history: [{ role: "user" as const, text: "解析图片" }],
      images: [
        {
          personalFileId,
          displayName: "fixture.png",
          data: "aW1hZ2U=",
          mimeType: "image/png" as const,
        },
      ],
    };
    expect(piPromptFrameSchema.parse(baseFrame).images).toHaveLength(1);
    expect(() =>
      piPromptFrameSchema.parse({
        ...baseFrame,
        images: [{ ...baseFrame.images[0], data: "not base64" }],
      }),
    ).toThrow();

    const preview = {
      objectKind: "personal_file" as const,
      objectId: personalFileId,
      displayName: "fixture.png",
      format: "png" as const,
      source: null,
      imageDataUrl: "data:image/png;base64,aW1hZ2U=",
      parsedText: "",
      citations: [],
    };
    expect(parseChatCommandResult("file.preview", preview).imageDataUrl).toBe(preview.imageDataUrl);
    expect(() =>
      parseChatCommandResult("file.preview", {
        ...preview,
        imageDataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
      }),
    ).toThrow();
  });

  it("rejects unknown chat fields and weak mutation idempotency keys", () => {
    expect(() =>
      chatCommandEnvelopeSchema.parse({
        command: "chat.send",
        input: { text: "hello", idempotencyKey: "short", executable: "rm" },
      }),
    ).toThrow();
  });

  it("carries validated thinking levels through chat and Pi prompt contracts", () => {
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "chat.send",
        input: {
          text: "深入分析",
          idempotencyKey: "thinking-contract-0001",
          thinkingLevel: "high",
        },
      }),
    ).toMatchObject({ input: { thinkingLevel: "high" } });
    expect(
      piPromptFrameSchema.parse({
        kind: "pi.session.prompt",
        generationId: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        assistantMessageId: crypto.randomUUID(),
        thinkingLevel: "xhigh",
        history: [{ role: "user", text: "分析" }],
      }),
    ).toMatchObject({ thinkingLevel: "xhigh" });
    expect(() =>
      chatCommandEnvelopeSchema.parse({
        command: "chat.selectThinkingLevel",
        input: { conversationId: crypto.randomUUID(), thinkingLevel: "unlimited" },
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
        ownerProfileId: "local-default",
        deviceId: "00000000-0000-4000-8000-000000000000",
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

describe("M7 Skill contracts", () => {
  it("accepts an open Skill manifest and rejects unsafely shaped installation metadata", () => {
    expect(
      skillPackageManifestSchema.parse({
        version: "1.2.3",
        publisher: "Fixture",
        tools: ["openerx_skill_script"],
        permissions: [
          {
            capability: "shell",
            actions: ["execute"],
            targets: ["scripts/run.mjs"],
            reason: "Run the declared script.",
          },
        ],
        platforms: ["darwin", "win32"],
        scripts: ["scripts/run.mjs"],
      }),
    ).toMatchObject({ version: "1.2.3", publisher: "Fixture" });
    expect(() =>
      skillInstallationSchema.parse({
        id: crypto.randomUUID(),
        ownerProfileId: "local-default",
        name: "unsafe-skill",
        displayName: "Unsafe",
        description: "Fixture",
        version: "1.0.0",
        publisher: "Fixture",
        scope: "workspace",
        workspaceId: null,
        sourceKind: "local_directory",
        sourceLabel: "fixture",
        checksumSha256: "a".repeat(64),
        trust: "unverified",
        enabled: false,
        autoInvoke: false,
        packageState: "installed",
        permissionDigest: "b".repeat(64),
        approvedPermissionDigest: null,
        declaredTools: [],
        declaredMcpServers: [],
        permissions: [],
        platforms: ["darwin"],
        rollbackVersions: [],
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsedAt: null,
        revision: 1,
        localPackagePath: "/must-not-cross-contract",
      }),
    ).toThrow();
  });
});
