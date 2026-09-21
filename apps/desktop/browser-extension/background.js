const protocolVersion = "openerx_browser_bridge_v1";
const tabs = new Map();
let config = null,
  connectionId = null,
  polling = false,
  sendTail = Promise.resolve();
const sourcePromise = fetch(chrome.runtime.getURL("page-agent.js")).then((r) => r.text());
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function siteCheck(record, url, checkOnly = false) {
  if (!/^https?:\/\//.test(url || "")) throw new Error("BROWSER_NAVIGATION_DENIED");
  const response = await api("/site-check", {
    grantId: record.grantId,
    intentId: record.authorizationId,
    requestId: record.activeRequestId,
    url,
    checkOnly,
  });
  if (!response.allowed) throw new Error("BROWSER_NAVIGATION_DENIED");
}
async function settle(record) {
  // A click schedules navigation after Runtime.evaluate returns. Wait for the ensuing document.
  await delay(100);
  const deadline = Date.now() + 170000;
  while (record.loading && tabs.has(record.tabId) && Date.now() < deadline) await delay(50);
  if (!tabs.has(record.tabId) || record.loading) throw new Error("BROWSER_OBSERVATION_MISMATCH");
}
async function manage(request) {
  if (request.kind === "list_tabs") {
    const candidates = await chrome.tabs.query({});
    return {
      tabs: candidates
        .filter((tab) => /^https?:\/\//.test(tab.url || "") && !tab.incognito)
        .map((tab) => ({
          tabId: tab.id,
          browserWindowId: tab.windowId,
          url: tab.url,
          title: (tab.title || "").slice(0, 2000),
        })),
    };
  }
  let tab;
  if (request.kind === "claim_tab") {
    tab = await chrome.tabs.get(request.tab.tabId);
    if (
      tab.incognito ||
      tab.url !== request.tab.url ||
      tab.title !== request.tab.title ||
      tab.windowId !== request.tab.browserWindowId
    )
      throw new Error("BROWSER_SURFACE_MISMATCH");
    if (tabs.has(tab.id)) throw new Error("标签页正由其他任务控制");
  } else tab = await chrome.tabs.create({ url: "about:blank", active: false });
  const record = {
    tabId: tab.id,
    authorizationId: request.requestId,
    sequence: 1,
    grantId: null,
    busy: true,
    loading: false,
  };
  await chrome.debugger.attach({ tabId: tab.id }, "1.3");
  tabs.set(tab.id, record);
  try {
    await cdp(tab.id, "Page.enable");
    await cdp(tab.id, "Fetch.enable", {
      patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }],
    });
    if (request.kind === "create_tab") {
      await siteCheck(record, request.url);
      const navigation = await cdp(tab.id, "Page.navigate", { url: request.url });
      if (navigation.errorText) throw new Error("BROWSER_NAVIGATION_DENIED");
      await settle(record);
    }
    tab = await chrome.tabs.get(tab.id);
    await siteCheck(record, tab.url, true);
    record.status = await evaluate(tab.id, "globalThis.__openerxPageAgent.status()");
    record.binding = binding(tab, record.status);
    const authorization = await api("/authorize", {
      protocolVersion,
      kind: "authorize_tab",
      messageId: request.requestId,
      sequence: 1,
      binding: record.binding,
    });
    record.busy = false;
    return { browserContextRef: authorization.browserContextRef };
  } catch (error) {
    await release(record);
    if (request.kind === "create_tab") await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
}
async function api(route, body) {
  if (!config) throw new Error("请先填写桌面应用设置中的配对码");
  const response = await fetch(config.base + route, {
    method: body === undefined ? "GET" : "POST",
    mode: "cors",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-Openerx-Bridge-Version": "2",
      ...(connectionId ? { "X-Openerx-Connection": connectionId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(route === "/site-check" ? 175000 : 25000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "配对已失效，请从桌面应用获取新配对码"
        : response.status === 426
          ? "请重新导出并刷新浏览器扩展"
          : "浏览器连接暂时中断",
    );
  return await response.json();
}
async function cdp(tabId, method, params = {}) {
  return await chrome.debugger.sendCommand({ tabId }, method, params);
}
async function evaluate(tabId, expression) {
  const { frameTree } = await cdp(tabId, "Page.getFrameTree");
  const { executionContextId } = await cdp(tabId, "Page.createIsolatedWorld", {
    frameId: frameTree.frame.id,
    worldName: "openerx-browser-control",
  });
  const response = await cdp(tabId, "Runtime.evaluate", {
    contextId: executionContextId,
    expression: `${await sourcePromise}\n${expression}`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails)
    throw new Error(response.exceptionDetails.exception?.description || "页面观察已失效");
  return response.result.value;
}
const binding = (tab, state) => ({
  browserWindowId: tab.windowId,
  tabId: tab.id,
  documentId: state.documentId,
  url: state.url,
  origin: new URL(state.url).origin,
});
function emit(record, data) {
  const message = {
    protocolVersion,
    grantId: record.grantId,
    sequence: ++record.sequence,
    ...data,
  };
  sendTail = sendTail.catch(() => {}).then(() => api("/message", message));
  return sendTail;
}
async function release(record) {
  tabs.delete(record.tabId);
  try {
    await chrome.debugger.detach({ tabId: record.tabId });
  } catch {}
}
async function event(record, kind, state = record.status) {
  if (!record.grantId) {
    await release(record);
    return;
  }
  const tab = await chrome.tabs.get(record.tabId).catch(() => null);
  const currentBinding = tab ? binding(tab, state) : record.binding;
  await emit(record, {
    kind: "event",
    event: kind,
    binding: currentBinding,
    pageRevision: state.pageRevision,
  });
  record.status = state;
  record.binding = currentBinding;
  if (!["user_input", "same_origin_navigation"].includes(kind)) await release(record);
}
async function refresh(record) {
  const tab = await chrome.tabs.get(record.tabId);
  await siteCheck(record, tab.url, true);
  const state = await evaluate(record.tabId, "globalThis.__openerxPageAgent.status()");
  if (state.documentId !== record.status.documentId || state.url !== record.status.url)
    await event(record, "same_origin_navigation", state);
  else if (state.userEpoch > record.status.userEpoch) {
    await event(record, "user_input", state);
    throw new Error("用户已接管");
  }
  record.status = state;
  return state;
}
async function capture(record, snapshot) {
  const { data } = await cdp(record.tabId, "Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const image = await createImageBitmap(
    await (await fetch(`data:image/png;base64,${data}`)).blob(),
  );
  const canvas = new OffscreenCanvas(image.width, image.height),
    ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  ctx.fillStyle = "#303030";
  for (const r of snapshot.sensitiveRects) {
    const sx = image.width / snapshot.viewport.width,
      sy = image.height / snapshot.viewport.height;
    ctx.fillRect(
      Math.floor(r.x * sx) - 3,
      Math.floor(r.y * sy) - 3,
      Math.ceil(r.width * sx) + 6,
      Math.ceil(r.height * sy) + 6,
    );
  }
  image.close();
  const bytes = new Uint8Array(
    await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
  );
  let text = "";
  for (let i = 0; i < bytes.length; i += 16384)
    text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return {
    type: "image",
    mimeType: "image/png",
    data: btoa(text),
    captureScope: "tab",
    redacted: true,
  };
}
async function command(request) {
  if (["list_tabs", "claim_tab", "create_tab"].includes(request.kind)) {
    try {
      const result = await manage(request);
      await api("/message", { kind: "management_result", requestId: request.requestId, ...result });
    } catch (error) {
      await api("/message", {
        kind: "management_result",
        requestId: request.requestId,
        error: String(error.message),
      });
    }
    return;
  }
  if (request.kind === "grant_accepted") {
    const record = [...tabs.values()].find(
      (r) => r.authorizationId === request.authorizationMessageId,
    );
    if (record) record.grantId = request.grantId;
    return;
  }
  const record = [...tabs.values()].find((r) => r.grantId === request.grantId);
  if (!record) return;
  if (request.kind === "release") {
    await release(record);
    return;
  }
  while (record.busy && tabs.has(record.tabId)) await delay(20);
  if (!tabs.has(record.tabId)) return;
  record.busy = true;
  record.activeRequestId = request.requestId;
  try {
    const tab = await chrome.tabs.get(record.tabId);
    if (record.loading) await settle(record);
    const state = await refresh(record);
    if (
      tab.id !== request.expectedBinding.tabId ||
      tab.windowId !== request.expectedBinding.browserWindowId
    )
      throw new Error("BROWSER_SURFACE_MISMATCH");
    if (
      request.kind === "act" &&
      JSON.stringify(binding(tab, state)) !== JSON.stringify(request.expectedBinding)
    )
      throw new Error("BROWSER_OBSERVATION_MISMATCH");
    if (request.kind === "observe") {
      const snapshot = await evaluate(record.tabId, "globalThis.__openerxPageAgent.snapshot()");
      const image = await capture(record, snapshot);
      const after = await refresh(record);
      await emit(record, {
        kind: "observation",
        requestId: request.requestId,
        binding: binding(tab, snapshot),
        pageRevision: snapshot.pageRevision,
        title: snapshot.title,
        viewport: snapshot.viewport,
        elements: snapshot.elements,
        ...(after.pageRevision === snapshot.pageRevision ? { image } : {}),
      });
    } else if (request.kind === "act") {
      if (state.pageRevision !== request.expectedPageRevision)
        throw new Error("BROWSER_OBSERVATION_MISMATCH");
      // Keep navigation responses bound to the originating document; refresh sends the navigation event afterwards.
      let result;
      record.navigationError = false;
      if (
        ["history_back", "history_forward", "reload", "navigate"].includes(request.command.kind)
      ) {
        if (request.command.kind === "navigate") {
          await siteCheck(record, request.command.url);
          await cdp(record.tabId, "Page.navigate", { url: request.command.url });
        } else if (request.command.kind === "reload") await cdp(record.tabId, "Page.reload");
        else {
          const history = await cdp(record.tabId, "Page.getNavigationHistory");
          const entry =
            history.entries[
              history.currentIndex + (request.command.kind === "history_back" ? -1 : 1)
            ];
          if (!entry) result = "unsupported";
          else {
            await siteCheck(record, entry.url);
            await cdp(record.tabId, "Page.navigateToHistoryEntry", { entryId: entry.id });
          }
        }
        result ||= "performed";
      } else {
        const destination = await evaluate(
          record.tabId,
          `globalThis.__openerxPageAgent.destination(${JSON.stringify(request.command)}, ${JSON.stringify(request.expectedPageRevision)})`,
        );
        if (destination) await siteCheck(record, destination);
        result = await evaluate(
          record.tabId,
          `globalThis.__openerxPageAgent.act(${JSON.stringify(request.command)}, ${JSON.stringify(request.expectedPageRevision)}, true)`,
        );
      }
      await settle(record);
      if (record.navigationError) throw new Error("BROWSER_NAVIGATION_DENIED");
      await emit(record, {
        kind: "action_result",
        requestId: request.requestId,
        binding: request.expectedBinding,
        expectedPageRevision: request.expectedPageRevision,
        pageRevisionAfter: request.expectedPageRevision,
        status: result,
      });
    }
  } catch (error) {
    const status = String(error.message).includes("BROWSER_OBSERVATION_MISMATCH")
      ? "stale_observation"
      : String(error.message).includes("BROWSER_NAVIGATION_DENIED")
        ? "navigation_denied"
        : String(error.message).includes("BROWSER_ELEMENT_NOT_INTERACTABLE")
          ? "element_not_interactable"
          : null;
    if (request.kind === "act" && status) {
      await emit(record, {
        kind: "action_result",
        requestId: request.requestId,
        binding: request.expectedBinding,
        expectedPageRevision: request.expectedPageRevision,
        pageRevisionAfter: request.expectedPageRevision,
        status,
      });
      return;
    }
    await api("/message", {
      requestId: request.requestId,
      kind: "error",
      error: String(error.message),
    }).catch(() => {});
    await release(record);
  } finally {
    record.busy = false;
    record.activeRequestId = null;
  }
}
async function poll() {
  if (polling || !config) return;
  polling = true;
  try {
    while (config) {
      try {
        if (!connectionId) connectionId = (await api("/connect", {})).connectionId;
        const { deliveries } = await api("/poll", {});
        for (const delivery of deliveries)
          if (delivery.expiresAt > Date.now()) await command(delivery.message);
      } catch (error) {
        console.error("Browser bridge:", error.message);
        connectionId = null;
        for (const record of [...tabs.values()]) await release(record);
        await delay(2000);
      }
    }
  } finally {
    polling = false;
  }
}
setInterval(() => {
  if (connectionId) void api("/heartbeat", {}).catch(() => {});
}, 10000);
setInterval(() => {
  for (const record of tabs.values()) {
    if (!record.grantId || record.busy || record.loading) continue;
    record.busy = true;
    refresh(record)
      .catch(() => {})
      .finally(() => {
        record.busy = false;
      });
  }
}, 400);
chrome.debugger.onEvent.addListener((source, method, params) => {
  const record = tabs.get(source.tabId);
  if (!record) return;
  if (method === "Page.frameStartedLoading") record.loading = true;
  if (method === "Page.frameStoppedLoading") record.loading = false;
  if (method === "Fetch.requestPaused")
    void (async () => {
      try {
        await siteCheck(record, params.request.url);
        await cdp(record.tabId, "Fetch.continueRequest", { requestId: params.requestId });
      } catch {
        record.navigationError = true;
        await cdp(record.tabId, "Fetch.failRequest", {
          requestId: params.requestId,
          errorReason: "BlockedByClient",
        }).catch(() => {});
      }
    })();
});
chrome.debugger.onDetach.addListener((source) => {
  const record = tabs.get(source.tabId);
  if (record) {
    tabs.delete(source.tabId);
    void event(record, "authorization_revoked").catch(() => {});
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  const record = tabs.get(tabId);
  if (record) void event(record, "tab_closed").catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return;
  (async () => {
    if (message.action === "status") return { connected: !!connectionId, authorized: tabs.size };
    if (message.action === "pair") {
      const code = new URL(message.code.trim());
      if (
        code.protocol !== "http:" ||
        code.hostname !== "127.0.0.1" ||
        !code.port ||
        !/^#[A-Za-z0-9_-]{43}$/.test(code.hash) ||
        code.username ||
        code.password ||
        code.pathname !== "/"
      )
        throw new Error("配对码格式不正确");
      config = { base: code.origin, token: code.hash.slice(1) };
      connectionId = null;
      connectionId = (await api("/connect", {})).connectionId;
      await chrome.storage.local.set({ config });
      void poll();
      return { ok: true };
    }
    if (message.action === "stop") {
      for (const record of [...tabs.values()]) await event(record, "authorization_revoked");
      return { ok: true };
    }
    if (message.action === "disconnect") {
      for (const record of [...tabs.values()]) await release(record);
      await api("/disconnect", {}).catch(() => {});
      config = null;
      connectionId = null;
      await chrome.storage.local.remove("config");
      return { ok: true };
    }
    throw new Error("操作不支持");
  })().then(
    (value) => reply(value),
    (error) => reply({ error: String(error.message) }),
  );
  return true;
});
chrome.storage.local.get("config").then((saved) => {
  if (!config && saved.config) {
    config = saved.config;
    void poll();
  }
});
