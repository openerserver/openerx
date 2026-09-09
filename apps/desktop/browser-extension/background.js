const protocolVersion = "openerx_browser_bridge_v1";
const tabs = new Map();
let config = null,
  connectionId = null,
  polling = false,
  sendTail = Promise.resolve();
const sourcePromise = fetch(chrome.runtime.getURL("page-agent.js")).then((r) => r.text());
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(route, body) {
  if (!config) throw new Error("请先填写 OpenERX 设置中的配对码");
  const response = await fetch(config.base + route, {
    method: body === undefined ? "GET" : "POST",
    mode: "cors",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(connectionId ? { "X-Openerx-Connection": connectionId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "配对已失效，请从 OpenERX 获取新配对码"
        : "OpenERX 连接中断，请重新配对",
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
  const state = await evaluate(record.tabId, "globalThis.__openerxPageAgent.status()");
  if (new URL(state.url).origin !== record.origin) {
    await event(record, "cross_origin_navigation", state);
    throw new Error("网站变化，需要重新授权");
  }
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
  try {
    const tab = await chrome.tabs.get(record.tabId);
    if (!tab.active) {
      await event(record, "tab_deactivated");
      return;
    }
    const state = await refresh(record);
    if (JSON.stringify(binding(tab, state)) !== JSON.stringify(request.expectedBinding))
      throw new Error("授权页面已经变化");
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
      if (["history_back", "history_forward", "reload"].includes(request.command.kind)) {
        if (request.command.kind === "reload") await cdp(record.tabId, "Page.reload");
        else {
          const history = await cdp(record.tabId, "Page.getNavigationHistory");
          const entry =
            history.entries[
              history.currentIndex + (request.command.kind === "history_back" ? -1 : 1)
            ];
          if (!entry) result = "unsupported";
          else if (new URL(entry.url).origin !== record.origin)
            throw new Error("BROWSER_NAVIGATION_DENIED");
          else await cdp(record.tabId, "Page.navigateToHistoryEntry", { entryId: entry.id });
        }
        result ||= "performed";
      } else
        result = await evaluate(
          record.tabId,
          `globalThis.__openerxPageAgent.act(${JSON.stringify(request.command)}, ${JSON.stringify(request.expectedPageRevision)})`,
        );
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
        console.error("OpenERX bridge poll:", error.message);
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
  for (const record of tabs.values()) {
    if (!record.grantId || record.busy) continue;
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
  if (method === "Fetch.requestPaused") {
    let allowed = false;
    try {
      allowed = new URL(params.request.url).origin === record.origin;
    } catch {}
    void cdp(record.tabId, allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
      requestId: params.requestId,
      ...(allowed ? {} : { errorReason: "BlockedByClient" }),
    }).catch(() => {});
  }
});
chrome.debugger.onDetach.addListener((source) => {
  const record = tabs.get(source.tabId);
  if (record) {
    tabs.delete(source.tabId);
    void event(record, "authorization_revoked").catch(() => {});
  }
});
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  for (const record of tabs.values())
    if (record.binding.browserWindowId === windowId && record.tabId !== tabId)
      void event(record, "tab_deactivated").catch(() => {});
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
      await chrome.storage.session.set({ config });
      void poll();
      return { ok: true };
    }
    if (message.action === "authorize") {
      if (!connectionId) throw new Error("请先配对 OpenERX");
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !/^https?:\/\//.test(tab.url)) throw new Error("只能授权 HTTP/HTTPS 网页");
      if (tabs.has(tab.id)) await release(tabs.get(tab.id));
      await chrome.debugger.attach({ tabId: tab.id }, "1.3");
      try {
        const status = await evaluate(tab.id, "globalThis.__openerxPageAgent.status()");
        const record = {
          tabId: tab.id,
          authorizationId: id("authorization"),
          sequence: 1,
          grantId: null,
          binding: binding(tab, status),
          status,
          origin: new URL(status.url).origin,
          busy: false,
        };
        tabs.set(tab.id, record);
        await cdp(tab.id, "Fetch.enable", {
          patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }],
        });
        const authorization = await api("/authorize", {
          protocolVersion,
          kind: "authorize_tab",
          messageId: record.authorizationId,
          sequence: 1,
          binding: record.binding,
        });
        return { ok: true, origin: authorization.origin };
      } catch (error) {
        const record = tabs.get(tab.id);
        if (record) await release(record);
        else await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
        throw error;
      }
    }
    if (message.action === "disconnect") {
      for (const record of [...tabs.values()]) await release(record);
      await api("/disconnect", {}).catch(() => {});
      config = null;
      connectionId = null;
      await chrome.storage.session.clear();
      return { ok: true };
    }
    throw new Error("操作不支持");
  })().then(
    (value) => reply(value),
    (error) => reply({ error: String(error.message) }),
  );
  return true;
});
chrome.storage.session.get("config").then((saved) => {
  if (!config && saved.config) {
    config = saved.config;
    void poll();
  }
});
