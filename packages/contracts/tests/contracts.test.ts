import { describe, expect, it } from "vitest";
import {
  appServiceBootstrapSchema,
  chatCommandEnvelopeSchema,
  desktopEnvironmentSchema,
  desktopMcpServerSaveInputSchema,
  desktopNativePermissionRequestSchema,
  desktopNativePermissionResultSchema,
  errorEnvelopeSchema,
  hostToolAvailabilitySchema,
  mainCapabilityAvailabilityRequestFrameSchema,
  mainCapabilityAvailabilityResponseFrameSchema,
  mainCredentialRequestFrameSchema,
  mainOAuthRequestFrameSchema,
  modelCatalogEntrySchema,
  parseChatCommandResult,
  piActivityEventSchema,
  piFileToolRequestFrameSchema,
  piHostEventFrameSchema,
  piPromptFrameSchema,
  redactSensitiveText,
  runItemSchema,
  safeErrorMessage,
  skillInstallationSchema,
  skillPackageManifestSchema,
  toolRuntimeReadinessSchema,
  workspaceChooseInputSchema,
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

  it("keeps native permission requests typed and reason-coded", () => {
    expect(desktopNativePermissionRequestSchema.parse({ permission: "accessibility" })).toEqual({
      permission: "accessibility",
    });
    expect(
      desktopNativePermissionResultSchema.parse({
        permission: "accessibility",
        status: "authorization_required",
        reason: "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED",
        settingsOpened: true,
      }),
    ).toMatchObject({ status: "authorization_required", settingsOpened: true });
    expect(() =>
      desktopNativePermissionRequestSchema.parse({
        permission: "accessibility",
        settingsUrl: "arbitrary://renderer-controlled",
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
  it("accepts bounded credential writes and strict desktop OAuth request frames", () => {
    const requestId = crypto.randomUUID();
    expect(
      mainCredentialRequestFrameSchema.parse({
        kind: "main.credential.request",
        requestId,
        operation: "save",
        credentialRef: "mcp:fixture",
        value: '{"version":2}',
      }),
    ).toMatchObject({ operation: "save", credentialRef: "mcp:fixture" });
    expect(
      mainOAuthRequestFrameSchema.parse({
        kind: "main.oauth.request",
        requestId,
        operation: "authorize",
        sessionId: crypto.randomUUID(),
        authorizationUrl: "https://identity.example/authorize",
      }),
    ).toMatchObject({ operation: "authorize" });
    expect(() =>
      mainOAuthRequestFrameSchema.parse({
        kind: "main.oauth.request",
        requestId,
        operation: "authorize",
        sessionId: crypto.randomUUID(),
        authorizationUrl: "https://identity.example/authorize",
        clientSecret: "must-not-cross-the-frame",
      }),
    ).toThrow();
  });

  it("accepts public OAuth authorization-code configuration and rejects client secrets", () => {
    const input = {
      config: {
        id: crypto.randomUUID(),
        name: "OAuth MCP",
        transport: "streamable_http" as const,
        url: "https://mcp.example/mcp",
        auth: "oauth" as const,
        credentialRef: null,
        enabled: true,
        enabledTools: [],
      },
      oauthClientId: "public-desktop-client",
      oauthScope: "tools.read",
    };
    expect(desktopMcpServerSaveInputSchema.parse(input)).toEqual(input);
    expect(() =>
      desktopMcpServerSaveInputSchema.parse({
        ...input,
        oauthClientSecret: "desktop-apps-must-not-collect-this",
      }),
    ).toThrow();
  });

  it("accepts typed Run Items and rejects raw reasoning content", () => {
    const base = {
      id: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      sequence: 1,
      piItemRef: "reasoning:1:1",
      status: "completed" as const,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(
      runItemSchema.parse({
        ...base,
        content: {
          type: "reasoning",
          summary: "Reasoning completed; only a safe Run summary was stored.",
          reasoningTokens: 12,
          contentRedacted: true,
        },
      }),
    ).toMatchObject({ content: { type: "reasoning", contentRedacted: true } });
    expect(() =>
      runItemSchema.parse({
        ...base,
        content: {
          type: "reasoning",
          summary: "done",
          reasoningTokens: null,
          contentRedacted: true,
          rawThinking: "must not cross the contract",
        },
      }),
    ).toThrow();
    expect(
      piActivityEventSchema.parse({
        kind: "pi.activity-event",
        generationId: crypto.randomUUID(),
        eventId: crypto.randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "plan.updated",
        piItemRef: "plan:1",
        planEntries: [{ text: "verify", status: "in_progress" }],
      }),
    ).toMatchObject({ type: "plan.updated" });
  });

  it("accepts bounded Office artifact requests and SVG review surfaces", () => {
    const artifactRequest = piFileToolRequestFrameSchema.parse({
      kind: "pi.file-tool.request",
      requestId: crypto.randomUUID(),
      generationId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      branchId: crypto.randomUUID(),
      assistantMessageId: crypto.randomUUID(),
      piToolCallId: "office-call",
      toolName: "openerx_office_artifact",
      request: {
        operation: "artifact.office.write",
        input: {
          displayName: "review",
          spec: {
            format: "pptx",
            title: "Review",
            slides: [{ title: "Gate", bullets: ["Inspect every slide"] }],
          },
        },
      },
    });
    expect(artifactRequest.request).toMatchObject({
      operation: "artifact.office.write",
      input: {
        spec: {
          format: "pptx",
          theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
        },
      },
    });
    const preview = parseChatCommandResult("artifact.preview", {
      objectKind: "artifact",
      objectId: crypto.randomUUID(),
      displayName: "review.pptx",
      format: "pptx",
      source: null,
      imageDataUrl: null,
      renderedSurfaces: [
        {
          kind: "slide",
          index: 1,
          label: "幻灯片 1",
          imageDataUrl: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
          modelImageDataUrl: `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
        },
      ],
      parsedText: "Gate",
      citations: [],
    });
    expect(preview.renderedSurfaces).toHaveLength(1);
  });

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
      branchId: crypto.randomUUID(),
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
    expect(() =>
      workspaceChooseInputSchema.parse({
        conversationId: crypto.randomUUID(),
        access: "read_write",
        allowNetwork: false,
        expiresAt: null,
        rootPath: "/renderer-must-not-select-this-path",
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
        branchId: crypto.randomUUID(),
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

  it("keeps model capabilities separate from host tools and allows mandatory reasoning", () => {
    const model = modelCatalogEntrySchema.parse({
      modelRef: "platform/reasoning",
      displayName: "Reasoning",
      version: "2026-08-27",
      capabilities: {
        textInput: true,
        imageInput: false,
        fileInput: false,
        functionCalling: true,
        structuredOutput: true,
      },
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      status: "available",
      priceRef: "price/reasoning",
      priceSummary: "fixture",
      free: false,
      thinkingLevels: ["medium", "high"],
    });
    expect(model.thinkingLevels).toEqual(["medium", "high"]);
    expect(model.capabilities).not.toHaveProperty("mcp");
    expect(
      hostToolAvailabilitySchema.parse({
        availableToolNames: ["openerx_workspace_read", "mcp__fixture__read_abcdef"],
        unavailableReasons: { openerx_desktop: "host_not_connected" },
      }),
    ).toMatchObject({
      availableToolNames: ["openerx_workspace_read", "mcp__fixture__read_abcdef"],
    });
  });

  it("strictly validates runtime tool readiness and Main availability frames", () => {
    const requestId = crypto.randomUUID();
    const checkedAt = "2026-08-27T06:00:00.000Z";
    const readiness = toolRuntimeReadinessSchema.parse({
      capability: "desktop",
      status: "degraded",
      reason: "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED",
      availableToolNames: ["openerx_desktop"],
      checkedAt,
    });
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "tool.runtime.readiness",
        input: { authenticated: false, platformConfigured: true },
      }),
    ).toMatchObject({ command: "tool.runtime.readiness" });
    expect(parseChatCommandResult("tool.runtime.readiness", [readiness])).toEqual([readiness]);
    expect(() => toolRuntimeReadinessSchema.parse({ ...readiness, unexpected: true })).toThrow();
    expect(
      mainCapabilityAvailabilityRequestFrameSchema.parse({
        kind: "main.capability.availability.request",
        requestId,
      }),
    ).toMatchObject({ requestId });
    expect(
      mainCapabilityAvailabilityResponseFrameSchema.parse({
        kind: "main.capability.availability.response",
        requestId,
        ok: true,
        data: { availableToolNames: ["openerx_browser"], unavailableReasons: {} },
      }),
    ).toMatchObject({ ok: true });
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
        defaultWorkspaceDirectory: "/documents/OpenERX Workspace",
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
