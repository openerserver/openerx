/** Bound both headers and body reads so one stalled request cannot freeze discovery. */
export async function fetchMobileJson(
  url: string | URL,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<{ response: Response; value: unknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("REMOTE_REQUEST_TIMEOUT"));
          controller.abort();
        }, timeoutMs);
      }),
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        return { response, value: (await response.json()) as unknown };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
