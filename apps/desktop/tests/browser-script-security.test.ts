// @vitest-environment jsdom
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeHtmlText } from "../scripts/escape-html-text";
import {
  browserClickScript,
  browserTargetScript,
  browserTypeScript,
} from "../src/main/legacy-browser-script";

const hostileStrings = [
  '");globalThis.injected=true;//',
  "');globalThis.injected=true;//",
  "</script><script>globalThis.injected=true</script>",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Deliberate injection input.
  "` ${globalThis.injected=true}",
  '\\"\r\n\u2028\u2029\0',
  "中文 😀 \ud800 \udfff",
];

function run(script: string) {
  const context = {
    document,
    HTMLElement,
    HTMLInputElement,
    HTMLTextAreaElement,
    Event,
    injected: false,
  };
  const result = runInNewContext(script, context, { timeout: 1_000 });
  expect(context.injected).toBe(false);
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("legacy browser script parameter boundary", () => {
  it.each(hostileStrings)("keeps selector and typed text as data: %j", (value) => {
    const element = document.createElement("textarea");
    const query = vi.spyOn(document, "querySelector").mockReturnValue(element);
    const input = vi.fn();
    element.addEventListener("input", input);
    const click = vi.spyOn(element, "click");
    expect(run(browserTypeScript(value, value))).toBe(true);
    expect(element.value).toBe(value.replace(/\r\n?/g, "\n"));
    expect(input).toHaveBeenCalledOnce();
    expect(run(browserTargetScript(value))).toMatchObject({ tag: "textarea" });
    expect(run(browserClickScript(value))).toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect(query.mock.calls).toEqual([[value], [value], [value]]);
  });

  it("preserves real DOM selection, input events and click target metadata", () => {
    document.body.innerHTML =
      '<textarea id="query"></textarea><button id="send" type="submit" aria-label="Send"></button>';
    const element = document.querySelector("textarea");
    const input = vi.fn();
    document.body.addEventListener("input", input, { once: true });
    expect(run(browserTypeScript("#query", "hello 中文"))).toBe(true);
    expect(element?.value).toBe("hello 中文");
    expect(document.activeElement).toBe(element);
    expect(input).toHaveBeenCalledOnce();
    expect(run(browserTargetScript("#send"))).toEqual({
      tag: "button",
      type: "submit",
      role: null,
      text: "Send",
    });
    const clicked = vi.fn();
    document.querySelector("button")?.addEventListener("click", clicked);
    run(browserClickScript("#send"));
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("rejects absent and non-editable targets and handles the full text limit", () => {
    document.body.innerHTML = '<div id="readonly"></div><textarea id="query"></textarea>';
    expect(() => run(browserTypeScript("#readonly", "x"))).toThrow("BROWSER_TARGET_NOT_EDITABLE");
    expect(() => run(browserTargetScript("#missing"))).toThrow("BROWSER_TARGET_NOT_FOUND");
    expect(() => run(browserClickScript("#missing"))).toThrow("BROWSER_TARGET_NOT_FOUND");
    const text = "😀".repeat(50_000);
    run(browserTypeScript("#query", text));
    expect(document.querySelector("textarea")?.value).toBe(text);
  });
});

describe("browser fixture HTML encoding", () => {
  it.each([
    "<script>globalThis.injected=true</script>",
    '<img src=x onerror="globalThis.injected=true">',
    '</p><svg onload="globalThis.injected=true">',
    '" autofocus onfocus="globalThis.injected=true',
    "&lt;script&gt; & \" ' 中文",
  ])("preserves visible text without creating executable elements: %j", (value) => {
    const container = document.createElement("div");
    container.innerHTML = `<p title="${escapeHtmlText(value)}">${escapeHtmlText(value)}</p>`;
    expect(container.children).toHaveLength(1);
    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toBe(value);
    expect(paragraph?.getAttribute("title")).toBe(value);
    expect(paragraph?.attributes).toHaveLength(1);
    expect(paragraph?.children).toHaveLength(0);
    expect(container.querySelector("script, img, svg, [onerror], [onload], [onfocus]")).toBeNull();
  });
});
