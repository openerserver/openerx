/* Runs only in an isolated world, shared by the extension and managed Chromium. */
(() => {
  if (globalThis.__openerxPageAgent) return;
  const documentId = `document_${crypto.randomUUID()}`;
  let revision = 0;
  let userEpoch = 0;
  let counter = 0;
  const ids = new WeakMap();
  const nodes = new Map();
  const changed = () => {
    revision++;
  };
  const observer = new MutationObserver(changed);
  observer.observe(document, {
    subtree: true,
    attributes: true,
    childList: true,
    characterData: true,
  });
  for (const event of ["scroll", "resize", "input", "change"])
    addEventListener(event, changed, true);
  for (const event of ["pointerdown", "keydown", "wheel"])
    addEventListener(
      event,
      (e) => {
        if (e.isTrusted) {
          userEpoch++;
          changed();
        }
      },
      true,
    );
  const flush = () => {
    if (observer.takeRecords().length) changed();
  };
  const pageRevision = () => {
    flush();
    return `${documentId}_${revision}`;
  };
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.round(r.x)),
      y = Math.max(0, Math.round(r.y));
    return {
      x,
      y,
      width: Math.max(1, Math.round(Math.min(innerWidth, r.right) - x)),
      height: Math.max(1, Math.round(Math.min(innerHeight, r.bottom) - y)),
    };
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect(),
      style = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < innerHeight &&
      r.left < innerWidth &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  };
  const sensitive = (el) => {
    const s =
      `${el.type || ""} ${el.autocomplete || ""} ${el.name || ""} ${el.id || ""}`.toLowerCase();
    if (/password/.test(s)) return "password";
    if (/cc-|card.?number|cvv|cvc/.test(s)) return "payment";
    if (/one-time-code|otp|verification|auth.?code/.test(s)) return "authentication";
    return "none";
  };
  const editable = (el) =>
    (["INPUT", "TEXTAREA"].includes(el.tagName) &&
      !["button", "submit", "checkbox", "radio", "file", "hidden"].includes(el.type)) ||
    el.isContentEditable;
  const snapshot = () => {
    const elements = [],
      sensitiveRects = [];
    nodes.clear();
    for (const el of document.querySelectorAll(
      'input,textarea,select,button,a[href],[role],[contenteditable="true"],h1,h2,h3,p,label,iframe',
    )) {
      if (!visible(el)) continue;
      if (el.tagName === "IFRAME") {
        sensitiveRects.push(rect(el));
        continue;
      }
      const kind = sensitive(el);
      if (kind !== "none") sensitiveRects.push(rect(el));
      if (elements.length >= 2000) continue;
      if (!ids.has(el)) ids.set(el, `node_${++counter}`);
      const id = ids.get(el);
      nodes.set(id, el);
      const edit = editable(el);
      const actions = ["focus"];
      if (edit && !el.readOnly) actions.push("setValue");
      if (el.tagName === "SELECT") actions.push("select");
      if (
        el.matches(
          "a,button,input[type=submit],input[type=button],input[type=checkbox],input[type=radio],[role=button],[role=link]",
        )
      )
        actions.push("invoke");
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
        actions.push("scroll");
      const label =
        el.getAttribute("aria-label") ||
        [...(el.labels || [])].map((l) => l.textContent).join(" ") ||
        el.getAttribute("placeholder") ||
        (edit ? "" : el.innerText) ||
        el.title ||
        "";
      elements.push({
        sourceNodeId: id,
        role: el.getAttribute("role") || (edit ? "textbox" : el.tagName.toLowerCase()),
        name: label.slice(0, 500),
        value: kind === "none" && "value" in el ? String(el.value).slice(0, 2000) : null,
        sensitiveKind: kind,
        visible: true,
        state: {
          disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true",
          checked: "checked" in el ? !!el.checked : null,
          selected: "selected" in el ? !!el.selected : null,
          expanded: el.hasAttribute("aria-expanded")
            ? el.getAttribute("aria-expanded") === "true"
            : null,
          focused: document.activeElement === el,
          editable: edit && !el.readOnly,
        },
        bounds: rect(el),
        actions,
      });
    }
    return {
      documentId,
      pageRevision: pageRevision(),
      userEpoch,
      url: location.href,
      title: document.title.slice(0, 2000),
      viewport: { width: innerWidth, height: innerHeight, scaleFactor: devicePixelRatio },
      elements,
      sensitiveRects,
    };
  };
  const act = (command, expectedRevision) => {
    if (pageRevision() !== expectedRevision) throw new Error("BROWSER_OBSERVATION_MISMATCH");
    const el = command.sourceNodeId ? nodes.get(command.sourceNodeId) : null;
    if (command.sourceNodeId && (!el?.isConnected || !visible(el)))
      throw new Error("BROWSER_ELEMENT_NOT_INTERACTABLE");
    if (el && (sensitive(el) !== "none" || el.type === "file")) return "user_takeover_required";
    if (el?.disabled || el?.getAttribute("aria-disabled") === "true")
      throw new Error("BROWSER_ELEMENT_NOT_INTERACTABLE");
    const scroll = (target) => {
      const size =
        command.direction === "left" || command.direction === "right" ? innerWidth : innerHeight;
      const d = { small: 100, medium: 350, viewport: size * 0.85, edge: 100000 }[command.distance];
      target.scrollBy({
        left: command.direction === "left" ? -d : command.direction === "right" ? d : 0,
        top: command.direction === "up" ? -d : command.direction === "down" ? d : 0,
        behavior: "instant",
      });
    };
    switch (command.kind) {
      case "focus":
        el.focus();
        break;
      case "invoke": {
        const link = el.closest("a[href]");
        if (link && (new URL(link.href).origin !== location.origin || !/^https?:/.test(link.href)))
          throw new Error("BROWSER_NAVIGATION_DENIED");
        el.click();
        break;
      }
      case "set_value":
      case "type_text": {
        if (!editable(el) || el.readOnly) return "unsupported";
        el.focus();
        const text =
          command.kind === "type_text"
            ? (el.value || el.textContent || "") + command.text
            : command.text;
        if (el.isContentEditable) el.textContent = text;
        else
          Object.getOwnPropertyDescriptor(
            el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            "value",
          ).set.call(el, text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
      case "select": {
        if (el.tagName !== "SELECT") return "unsupported";
        const option = [...el.options].find(
          (o) => o.value === command.option || o.text === command.option,
        );
        if (!option) return "unsupported";
        el.value = option.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
      case "scroll_element":
        scroll(el);
        break;
      case "scroll_viewport":
        scroll(window);
        break;
      case "key": {
        const focused = document.activeElement;
        if (sensitive(focused) !== "none" || focused?.tagName === "IFRAME")
          return "user_takeover_required";
        if (command.key === "Enter" && focused?.form) {
          if (new URL(focused.form.action || location.href).origin !== location.origin)
            throw new Error("BROWSER_NAVIGATION_DENIED");
          focused.form.requestSubmit();
        } else return "unsupported";
        break;
      }
      default:
        return "unsupported";
    }
    changed();
    return "performed";
  };
  globalThis.__openerxPageAgent = {
    snapshot,
    act,
    status: () => ({ documentId, pageRevision: pageRevision(), userEpoch, url: location.href }),
  };
})();
