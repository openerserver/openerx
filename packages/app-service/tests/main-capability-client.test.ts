import type {
  MainAutomationContextRequestFrame,
  MainCapabilityAvailabilityRequestFrame,
  MainCredentialRequestFrame,
  MainOAuthRequestFrame,
} from "@openerx/contracts";
import {
  mainAutomationContextRequestFrameSchema,
  mainCapabilityAvailabilityRequestFrameSchema,
  mainCredentialRequestFrameSchema,
  mainOAuthRequestFrameSchema,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import { MainCapabilityClient } from "../src/main-capability-client";

function fixture() {
  const frames: unknown[] = [];
  const port = {
    postMessage: vi.fn((frame: unknown) => frames.push(frame)),
  } as unknown as MessagePortMain;
  const client = new MainCapabilityClient(port);
  return {
    client,
    automationContextFrame: (): MainAutomationContextRequestFrame =>
      mainAutomationContextRequestFrameSchema.parse(frames.at(-1)),
    availabilityFrame: (): MainCapabilityAvailabilityRequestFrame =>
      mainCapabilityAvailabilityRequestFrameSchema.parse(frames.at(-1)),
    credentialFrame: (): MainCredentialRequestFrame =>
      mainCredentialRequestFrameSchema.parse(frames.at(-1)),
    oauthFrame: (): MainOAuthRequestFrame => mainOAuthRequestFrameSchema.parse(frames.at(-1)),
  };
}

describe("MainCapabilityClient Main bridge", () => {
  it("requests fresh automation execution context for unattended dispatch", async () => {
    const { client, automationContextFrame } = fixture();
    const resolving = client.automationExecutionContext();
    const request = automationContextFrame();
    expect(request.kind).toBe("main.automation-context.request");

    expect(
      client.handleMessage({
        kind: "main.automation-context.response",
        requestId: request.requestId,
        ok: true,
        data: {
          byok: {
            apiKey: "test-secret",
            baseUrl: "https://api.example.com",
            modelId: "example-model",
            displayName: "Example model",
            contextWindow: 128_000,
            maxOutputTokens: 8_192,
            capabilities: { imageInput: false, functionCalling: true, reasoning: true },
          },
        },
      }),
    ).toBe(true);
    await expect(resolving).resolves.toMatchObject({
      byok: { modelId: "example-model" },
    });
    client.close();
  });

  it("round-trips live Host tool availability", async () => {
    const { client, availabilityFrame } = fixture();
    const checking = client.availability();
    const request = availabilityFrame();
    expect(request.kind).toBe("main.capability.availability.request");
    expect(
      client.handleMessage({
        kind: "main.capability.availability.response",
        requestId: request.requestId,
        ok: true,
        data: {
          availableToolNames: ["openerx_browser"],
          unavailableReasons: {
            openerx_desktop: "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
          },
        },
      }),
    ).toBe(true);
    await expect(checking).resolves.toEqual({
      availableToolNames: ["openerx_browser"],
      unavailableReasons: {
        openerx_desktop: "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
      },
    });
    client.close();
  });

  it("round-trips credential save and OAuth prepare, authorize, and cancel frames", async () => {
    const { client, credentialFrame, oauthFrame } = fixture();

    const saving = client.save("mcp:fixture", '{"version":2}');
    const saveFrame = credentialFrame();
    expect(saveFrame).toMatchObject({
      operation: "save",
      credentialRef: "mcp:fixture",
      value: '{"version":2}',
    });
    expect(
      client.handleMessage({
        kind: "main.credential.response",
        requestId: saveFrame.requestId,
        ok: true,
      }),
    ).toBe(true);
    await saving;

    const serverId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const redirectUrl = "http://127.0.0.1:43111/oauth/mcp/callback";
    const preparing = client.prepareOAuth(serverId);
    const prepareFrame = oauthFrame();
    expect(prepareFrame).toMatchObject({ operation: "prepare", serverId });
    client.handleMessage({
      kind: "main.oauth.response",
      requestId: prepareFrame.requestId,
      ok: true,
      operation: "prepare",
      sessionId,
      redirectUrl,
    });
    await expect(preparing).resolves.toEqual({ sessionId, redirectUrl });

    const authorizationUrl = "https://identity.example/authorize?state=state-1";
    const callbackUrl = `${redirectUrl}?code=code-1&state=state-1`;
    const authorizing = client.waitForOAuthCallback(sessionId, authorizationUrl);
    const authorizeFrame = oauthFrame();
    expect(authorizeFrame).toMatchObject({ operation: "authorize", sessionId, authorizationUrl });
    client.handleMessage({
      kind: "main.oauth.response",
      requestId: authorizeFrame.requestId,
      ok: true,
      operation: "authorize",
      callbackUrl,
    });
    await expect(authorizing).resolves.toBe(callbackUrl);

    const cancelling = client.cancelOAuth(sessionId);
    const cancelFrame = oauthFrame();
    expect(cancelFrame).toMatchObject({ operation: "cancel", sessionId });
    client.handleMessage({
      kind: "main.oauth.response",
      requestId: cancelFrame.requestId,
      ok: true,
      operation: "cancel",
    });
    await cancelling;
    client.close();
  });
});
