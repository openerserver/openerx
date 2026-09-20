// Keep data out of JavaScript syntax. Encoding every UTF-16 code unit also
// preserves lone surrogates and prevents HTML delimiters if a script is reused.
function stringLiteral(value: string): string {
  const units = new Array<string>(value.length);
  for (let index = 0; index < value.length; index += 1) {
    units[index] = `\\u${value.charCodeAt(index).toString(16).padStart(4, "0")}`;
  }
  return `"${units.join("")}"`;
}

export function browserTypeScript(selector: string, text: string): string {
  return `(() => { const element = document.querySelector(${stringLiteral(selector)}); if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("BROWSER_TARGET_NOT_EDITABLE"); element.focus(); element.value = ${stringLiteral(text)}; element.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`;
}

export function browserTargetScript(selector: string): string {
  return `(() => { const element = document.querySelector(${stringLiteral(selector)}); if (!(element instanceof HTMLElement)) throw new Error("BROWSER_TARGET_NOT_FOUND"); return { tag: element.tagName.toLowerCase(), type: element.getAttribute("type"), role: element.getAttribute("role"), text: (element.innerText || element.getAttribute("aria-label") || "").slice(0, 200) }; })()`;
}

export function browserClickScript(selector: string): string {
  return `(() => { const element = document.querySelector(${stringLiteral(selector)}); if (!(element instanceof HTMLElement)) throw new Error("BROWSER_TARGET_NOT_FOUND"); element.click(); return true; })()`;
}
