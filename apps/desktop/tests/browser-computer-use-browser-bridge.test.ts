import { BROWSER_COMPUTER_USE_CONTRACT_VERSION, type BrowserObservation } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { BrowserActionDispatcher } from "../src/main/browser-computer-use/browser-action-dispatcher";
import {
  type BrowserBridgeEndpoint,
  BrowserBridgeGrantRegistry,
} from "../src/main/browser-computer-use/browser-bridge-grant-registry";
import {
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  type BrowserBridgeAuthorizeTabMessage,
  type BrowserBridgeEventMessage,
  type BrowserBridgePostMessage,
  type BrowserBridgeRequest,
  type BrowserBridgeTabBinding,
} from "../src/main/browser-computer-use/browser-bridge-protocol";
import { ConnectedChromeBrowserBridgeDriver } from "../src/main/browser-computer-use/connected-browser-bridge-driver";
import {
  type SystemBrowserBinding,
  type SystemBrowserControlEvent,
  type SystemBrowserDriverObservation,
  type SystemBrowserUserInputMonitor,
  SystemDefaultBrowserAdapter,
  type SystemDefaultBrowserDriver,
} from "../src/main/browser-computer-use/system-default-browser-adapter";
import { UIObservationRegistry } from "../src/main/browser-computer-use/ui-observation-registry";

const EXTENSION_ORIGIN = `chrome-extension://${"a".repeat(32)}/`;
const MAIN_CHANNEL_NONCE = "main-channel-nonce-0123456789-abcdef";
const PAGE_URL = "https://fixture.test/search";
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";

const NATIVE_SURFACE = {
  applicationId: "com.google.Chrome",
  nativeProcessId: 4242,
  nativeWindowId: "mac_window_9901",
};

function tabBinding(overrides: Partial<BrowserBridgeTabBinding> = {}): BrowserBridgeTabBinding {
  return {
    browserWindowId: 71,
    tabId: 81,
    documentId: "document_fixture_0001",
    url: PAGE_URL,
    origin: "https://fixture.test",
    ...overrides,
  };
}

function authorizationMessage(
  binding = tabBinding(),
  messageId = "authorization_fixture_0001",
): BrowserBridgeAuthorizeTabMessage {
  return {
    protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
    kind: "authorize_tab",
    messageId,
    sequence: 1,
    binding,
  };
}

class FakeBridgeEndpoint implements BrowserBridgeEndpoint {
  readonly requests: BrowserBridgeRequest[] = [];
  readonly posts: BrowserBridgePostMessage[] = [];
  binding = tabBinding();
  pageRevision = "page_revision_0001";
  sequence = 1;
  actionStatus: "performed" | "unsupported" | "user_takeover_required" = "performed";
  nextResponseBinding: BrowserBridgeTabBinding | null = null;
  replayNextSequence = false;
  leakSensitiveValue = false;
  passwordFocused = false;
  omitNextImage = false;
  #listener: ((message: unknown) => void) | null = null;
  #searchValue = "";

  async request(message: BrowserBridgeRequest, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new Error("BROWSER_CANCELLED");
    this.requests.push(structuredClone(message));
    const responseSequence = this.replayNextSequence ? this.sequence : ++this.sequence;
    this.replayNextSequence = false;
    const binding = this.nextResponseBinding ?? this.binding;
    this.nextResponseBinding = null;
    if (message.kind === "observe") {
      const includeImage = !this.omitNextImage;
      this.omitNextImage = false;
      return {
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
        kind: "observation",
        grantId: message.grantId,
        requestId: message.requestId,
        sequence: responseSequence,
        binding,
        pageRevision: this.pageRevision,
        title: "Browser Bridge fixture",
        viewport: { width: 960, height: 640, scaleFactor: 2 },
        elements: [
          {
            sourceNodeId: "bridge_node_search_1",
            role: "searchbox",
            name: "Search",
            value: this.#searchValue,
            sensitiveKind: "none",
            visible: true,
            state: {
              disabled: false,
              checked: null,
              selected: null,
              expanded: null,
              focused: !this.passwordFocused,
              editable: true,
            },
            bounds: { x: 20, y: 24, width: 500, height: 44 },
            actions: ["focus", "setValue", "invoke"],
          },
          {
            sourceNodeId: "bridge_node_password_1",
            role: "textbox",
            name: "Password",
            value: this.leakSensitiveValue ? "must-not-leak" : null,
            sensitiveKind: "password",
            visible: true,
            state: {
              disabled: false,
              checked: null,
              selected: null,
              expanded: null,
              focused: this.passwordFocused,
              editable: true,
            },
            bounds: { x: 20, y: 80, width: 500, height: 44 },
            actions: ["focus", "setValue"],
          },
        ],
        ...(includeImage
          ? {
              image: {
                type: "image",
                data: PNG_1X1,
                mimeType: "image/png",
                captureScope: "tab",
                redacted: true,
              },
            }
          : {}),
      };
    }

    if (message.command.kind === "set_value") this.#searchValue = message.command.text;
    this.pageRevision = `page_revision_${String(responseSequence).padStart(4, "0")}`;
    return {
      protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
      kind: "action_result",
      grantId: message.grantId,
      requestId: message.requestId,
      sequence: responseSequence,
      binding,
      expectedPageRevision: message.expectedPageRevision,
      pageRevisionAfter: this.pageRevision,
      status: this.actionStatus,
    };
  }

  post(message: BrowserBridgePostMessage): void {
    this.posts.push(structuredClone(message));
  }

  subscribe(listener: (message: unknown) => void): () => void {
    this.#listener = listener;
    return () => {
      if (this.#listener === listener) this.#listener = null;
    };
  }

  emit(
    event: BrowserBridgeEventMessage["event"],
    binding: BrowserBridgeTabBinding = this.binding,
  ): void {
    this.binding = structuredClone(binding);
    const grantId =
      this.posts.find((message) => message.kind === "grant_accepted")?.grantId ??
      this.requests.at(-1)?.grantId;
    if (!grantId) throw new Error("FAKE_BRIDGE_GRANT_NOT_ESTABLISHED");
    this.#listener?.({
      protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
      kind: "event",
      grantId,
      sequence: ++this.sequence,
      event,
      binding,
      pageRevision: this.pageRevision,
    } satisfies BrowserBridgeEventMessage);
  }
}

class UnusedSystemBrowserDriver implements SystemDefaultBrowserDriver {
  async openDedicatedWindow(): Promise<SystemBrowserBinding> {
    throw new Error("SYSTEM_BROWSER_DRIVER_MUST_NOT_BE_USED");
  }

  async startUserInputMonitoring(
    _binding: SystemBrowserBinding,
    _listener: (event: SystemBrowserControlEvent) => void,
  ): Promise<SystemBrowserUserInputMonitor> {
    throw new Error("SYSTEM_BROWSER_DRIVER_MUST_NOT_BE_USED");
  }

  async observe(): Promise<SystemBrowserDriverObservation> {
    throw new Error("SYSTEM_BROWSER_DRIVER_MUST_NOT_BE_USED");
  }

  async performSemantic(): Promise<"performed" | "unsupported"> {
    throw new Error("SYSTEM_BROWSER_DRIVER_MUST_NOT_BE_USED");
  }

  async performNativeInput(): Promise<"performed" | "unsupported"> {
    throw new Error("SYSTEM_BROWSER_DRIVER_MUST_NOT_BE_USED");
  }

  async performCoordinate(): Promise<"performed" | "unsupported"> {
    throw new Error("SYSTEM_BROWSER_DRIVER_MUST_NOT_BE_USED");
  }

  async closeOwnedWindow(): Promise<void> {
    throw new Error("SYSTEM_BROWSER_DRIVER_MUST_NOT_BE_USED");
  }
}

function registry(
  endpoint: FakeBridgeEndpoint,
  options: { now?: () => number; authorizationTtlMs?: number } = {},
) {
  const grants = new BrowserBridgeGrantRegistry({
    expectedExtensionOrigin: EXTENSION_ORIGIN,
    mainChannelNonce: MAIN_CHANNEL_NONCE,
    supportedApplicationIds: [NATIVE_SURFACE.applicationId],
    ...options,
  });
  const connection = grants.connect({
    callerOrigin: EXTENSION_ORIGIN,
    mainChannelNonce: MAIN_CHANNEL_NONCE,
    endpoint,
  });
  return { grants, connection };
}

function adapter(grants: BrowserBridgeGrantRegistry): SystemDefaultBrowserAdapter {
  const observations = new UIObservationRegistry();
  const bridge = new ConnectedChromeBrowserBridgeDriver(grants);
  return new SystemDefaultBrowserAdapter(
    new UnusedSystemBrowserDriver(),
    observations,
    new BrowserActionDispatcher(observations),
    bridge,
  );
}

function observation(result: Awaited<ReturnType<SystemDefaultBrowserAdapter["execute"]>>) {
  const data = result.data as { observation?: Omit<BrowserObservation, "image"> };
  if (!data.observation) throw new Error("BROWSER_BRIDGE_TEST_OBSERVATION_MISSING");
  return data.observation;
}

async function openAuthorizedBridge(endpoint = new FakeBridgeEndpoint()) {
  const { grants, connection } = registry(endpoint);
  const authorization = connection.authorizeTab(
    authorizationMessage(endpoint.binding),
    NATIVE_SURFACE,
  );
  const browser = adapter(grants);
  const signal = new AbortController().signal;
  const result = await browser.execute(
    {
      contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
      action: "open",
      url: PAGE_URL,
      browserContextRef: authorization.browserContextRef,
    },
    signal,
  );
  return { browser, endpoint, signal, initial: observation(result), result };
}

describe("BCU-003 connected Browser Bridge", () => {
  it("binds one user-authorized tab and sends only bounded semantic commands", async () => {
    const { browser, endpoint, signal, initial, result } = await openAuthorizedBridge();

    expect(result.sideEffectCommitted).toBe(false);
    expect(initial).toMatchObject({
      backend: "system_default",
      controlPath: "connected_browser_bridge",
      applicationId: NATIVE_SURFACE.applicationId,
      nativeProcessId: NATIVE_SURFACE.nativeProcessId,
      nativeWindowId: NATIVE_SURFACE.nativeWindowId,
      surfaceKind: "tab",
      ownership: "external_user",
      profilePersistence: "browser_owned",
    });
    expect(initial.capabilities).toMatchObject({
      semanticObserve: true,
      semanticAction: true,
      coordinateFallback: false,
      closeOwnedWindow: false,
    });
    expect(JSON.stringify(result.data)).not.toContain("tabId");
    expect(JSON.stringify(result.data)).not.toContain("browserWindowId");

    endpoint.omitNextImage = true;
    const semanticOnlyResult = await browser.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "observe",
        sessionId: initial.sessionId,
      },
      signal,
    );
    const semanticOnly = observation(semanticOnlyResult);
    expect(semanticOnly.visualObservationId).toBeNull();
    expect(semanticOnlyResult.content).toHaveLength(1);

    const search = semanticOnly.elements.find((element) => element.name === "Search");
    expect(search).toBeDefined();
    const acted = observation(
      await browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "setValue",
          sessionId: semanticOnly.sessionId,
          observationId: semanticOnly.observationId,
          target: { elementRef: search?.elementRef ?? "missing" },
          text: "phonescloud",
        },
        signal,
      ),
    );
    expect(acted.actionPath).toBe("semantic");
    expect(acted.elements.find((element) => element.name === "Search")?.value).toBe("phonescloud");
    const actionRequest = endpoint.requests.find((request) => request.kind === "act");
    expect(actionRequest).toMatchObject({
      kind: "act",
      command: { kind: "set_value", sourceNodeId: "bridge_node_search_1", text: "phonescloud" },
    });
    expect(JSON.stringify(actionRequest)).not.toMatch(/selector|xpath|javascript|evaluate|dom/iu);

    await expect(
      browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "close",
          sessionId: acted.sessionId,
          observationId: acted.observationId,
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_SCOPE_DENIED");
    const detached = await browser.execute(
      {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "detach",
        sessionId: acted.sessionId,
      },
      signal,
    );
    expect(detached.data).toMatchObject({ session: { state: "detached" } });
    expect(endpoint.posts.filter((message) => message.kind === "release")).toEqual([
      expect.objectContaining({
        kind: "release",
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
      }),
    ]);
  });

  it("rejects the wrong extension origin, launch nonce, replayed authorization and expired refs", () => {
    const endpoint = new FakeBridgeEndpoint();
    const grants = new BrowserBridgeGrantRegistry({
      expectedExtensionOrigin: EXTENSION_ORIGIN,
      mainChannelNonce: MAIN_CHANNEL_NONCE,
      supportedApplicationIds: [NATIVE_SURFACE.applicationId],
    });
    expect(() =>
      grants.connect({
        callerOrigin: `chrome-extension://${"b".repeat(32)}/`,
        mainChannelNonce: MAIN_CHANNEL_NONCE,
        endpoint,
      }),
    ).toThrow("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    expect(() =>
      grants.connect({
        callerOrigin: EXTENSION_ORIGIN,
        mainChannelNonce: "wrong-main-channel-nonce-0123456789",
        endpoint,
      }),
    ).toThrow("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");

    let now = 1_000;
    const expiring = registry(endpoint, { now: () => now, authorizationTtlMs: 1_000 });
    const message = authorizationMessage();
    const authorization = expiring.connection.authorizeTab(message, NATIVE_SURFACE);
    expect(() => expiring.connection.authorizeTab(message, NATIVE_SURFACE)).toThrow(
      "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED",
    );
    expect(() =>
      expiring.grants.claim(authorization.browserContextRef, "https://other.test/"),
    ).toThrow("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    now = 2_000;
    expect(() => expiring.grants.claim(authorization.browserContextRef, PAGE_URL)).toThrow(
      "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED",
    );

    const oneTimeEndpoint = new FakeBridgeEndpoint();
    const oneTime = registry(oneTimeEndpoint);
    const oneTimeAuthorization = oneTime.connection.authorizeTab(
      authorizationMessage(oneTimeEndpoint.binding, "authorization_fixture_0002"),
      NATIVE_SURFACE,
    );
    const claim = oneTime.grants.claim(oneTimeAuthorization.browserContextRef, PAGE_URL);
    expect(() => oneTime.grants.claim(oneTimeAuthorization.browserContextRef, PAGE_URL)).toThrow(
      "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED",
    );
    claim.release();

    const changedBeforeClaimEndpoint = new FakeBridgeEndpoint();
    const changedBeforeClaim = registry(changedBeforeClaimEndpoint);
    const changedAuthorization = changedBeforeClaim.connection.authorizeTab(
      authorizationMessage(changedBeforeClaimEndpoint.binding, "authorization_fixture_0003"),
      NATIVE_SURFACE,
    );
    changedBeforeClaimEndpoint.emit("user_input");
    expect(() =>
      changedBeforeClaim.grants.claim(changedAuthorization.browserContextRef, PAGE_URL),
    ).toThrow("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");

    const malformedEndpoint = new FakeBridgeEndpoint();
    const malformed = registry(malformedEndpoint);
    expect(() =>
      malformed.connection.authorizeTab(
        {
          ...authorizationMessage(malformedEndpoint.binding, "authorization_fixture_malformed"),
          applicationId: NATIVE_SURFACE.applicationId,
          tabs: [malformedEndpoint.binding],
        },
        NATIVE_SURFACE,
      ),
    ).toThrow("BROWSER_BRIDGE_DISCONNECTED");
  });

  it("invalidates stale observations on same-origin navigation and fails closed on cross-origin", async () => {
    const { browser, endpoint, signal, initial } = await openAuthorizedBridge();
    const sameOrigin = tabBinding({
      documentId: "document_fixture_0002",
      url: "https://fixture.test/next",
    });
    endpoint.emit("same_origin_navigation", sameOrigin);
    expect(browser.descriptor(initial.sessionId).state).toBe("active");
    const actionCount = endpoint.requests.filter((request) => request.kind === "act").length;
    await expect(
      browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "key",
          sessionId: initial.sessionId,
          observationId: initial.observationId,
          key: "Enter",
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_OBSERVATION_EXPIRED");
    expect(endpoint.requests.filter((request) => request.kind === "act")).toHaveLength(actionCount);

    const fresh = observation(
      await browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "observe",
          sessionId: initial.sessionId,
        },
        signal,
      ),
    );
    expect(fresh.url).toBe(sameOrigin.url);

    endpoint.emit(
      "cross_origin_navigation",
      tabBinding({
        documentId: "document_fixture_0003",
        url: "https://other.test/",
        origin: "https://other.test",
      }),
    );
    expect(browser.descriptor(initial.sessionId).state).toBe("failed");
    await expect(
      browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "observe",
          sessionId: initial.sessionId,
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_SESSION_NOT_FOUND");
  });

  it("disconnects on sequence replay or a response from another tab", async () => {
    const replay = await openAuthorizedBridge();
    replay.endpoint.replayNextSequence = true;
    await expect(
      replay.browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "observe",
          sessionId: replay.initial.sessionId,
        },
        replay.signal,
      ),
    ).rejects.toThrow("BROWSER_BRIDGE_DISCONNECTED");
    expect(replay.browser.descriptor(replay.initial.sessionId).state).toBe("failed");

    const wrongTab = await openAuthorizedBridge();
    wrongTab.endpoint.nextResponseBinding = tabBinding({ tabId: 999 });
    await expect(
      wrongTab.browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "observe",
          sessionId: wrongTab.initial.sessionId,
        },
        wrongTab.signal,
      ),
    ).rejects.toThrow("BROWSER_BRIDGE_DISCONNECTED");
    expect(wrongTab.browser.descriptor(wrongTab.initial.sessionId).state).toBe("failed");
  });

  it("requires user takeover before sending text to a sensitive field", async () => {
    const { browser, endpoint, signal, initial } = await openAuthorizedBridge();
    const password = initial.elements.find((element) => element.name === "Password");
    expect(password).toBeDefined();
    const actionCount = endpoint.requests.filter((request) => request.kind === "act").length;
    await expect(
      browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "setValue",
          sessionId: initial.sessionId,
          observationId: initial.observationId,
          target: { elementRef: password?.elementRef ?? "missing" },
          text: "must-not-reach-extension",
        },
        signal,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
    expect(endpoint.requests.filter((request) => request.kind === "act")).toHaveLength(actionCount);
    expect(browser.descriptor(initial.sessionId).state).toBe("paused_for_user");

    const focusedEndpoint = new FakeBridgeEndpoint();
    focusedEndpoint.passwordFocused = true;
    const focused = await openAuthorizedBridge(focusedEndpoint);
    const focusedActionCount = focused.endpoint.requests.filter(
      (request) => request.kind === "act",
    ).length;
    await expect(
      focused.browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "key",
          sessionId: focused.initial.sessionId,
          observationId: focused.initial.observationId,
          key: "Enter",
        },
        focused.signal,
      ),
    ).rejects.toThrow("BROWSER_USER_TAKEOVER_REQUIRED");
    expect(focused.endpoint.requests.filter((request) => request.kind === "act")).toHaveLength(
      focusedActionCount,
    );
  });

  it("rejects a bridge observation that includes a sensitive value", async () => {
    const endpoint = new FakeBridgeEndpoint();
    endpoint.leakSensitiveValue = true;
    const { grants, connection } = registry(endpoint);
    const authorization = connection.authorizeTab(authorizationMessage(), NATIVE_SURFACE);
    const browser = adapter(grants);
    await expect(
      browser.execute(
        {
          contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
          action: "open",
          url: PAGE_URL,
          browserContextRef: authorization.browserContextRef,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("BROWSER_BRIDGE_DISCONNECTED");
    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.posts.filter((message) => message.kind === "release")).toEqual([]);
  });
});
