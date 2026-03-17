if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

const noisyPatterns: RegExp[] = [
  /\[Vue Flow\]: The Vue Flow parent container needs a width and a height to render the graph/i,
  /\[Vue Flow\]: It seems that you haven't loaded the necessary styles/i,
];

function shouldSuppressConsoleMessage(args: unknown[]) {
  const text = args
    .map((value) =>
      typeof value === "string" ? value : value instanceof Error ? value.message : String(value),
    )
    .join(" ");
  return noisyPatterns.some((pattern) => pattern.test(text));
}

const nativeConsoleWarn = console.warn.bind(console);
console.warn = ((...args: unknown[]) => {
  if (shouldSuppressConsoleMessage(args)) {
    return;
  }
  nativeConsoleWarn(...args);
}) as typeof console.warn;

const nativeConsoleError = console.error.bind(console);
console.error = ((...args: unknown[]) => {
  if (shouldSuppressConsoleMessage(args)) {
    return;
  }
  nativeConsoleError(...args);
}) as typeof console.error;

const nativeGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element, pseudoElt?: string | null) =>
  nativeGetComputedStyle(
    element,
    pseudoElt ? undefined : pseudoElt,
  )) as typeof window.getComputedStyle;
