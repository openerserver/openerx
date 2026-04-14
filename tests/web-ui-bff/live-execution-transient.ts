const TRANSIENT_UPSTREAM_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.TEST_TRANSIENT_UPSTREAM_MAX_ATTEMPTS || "2", 10) || 2,
);

const TRANSIENT_UPSTREAM_RETRY_DELAY_MS = Math.max(
  250,
  Number.parseInt(process.env.TEST_TRANSIENT_UPSTREAM_RETRY_DELAY_MS || "1500", 10) || 1500,
);

const SOFT_SKIP_TRANSIENT_UPSTREAM_FAILURE =
  process.env.FAIL_ON_TRANSIENT_UPSTREAM_FAILURE !== "1";

export class TransientUpstreamExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientUpstreamExecutionError";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : JSON.stringify(error);
}

export function isTransientUpstreamExecutionText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("high demand") ||
    normalized.includes("service unavailable") ||
    normalized.includes('"code":503') ||
    normalized.includes('"status":"unavailable"') ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("provider overloaded")
  );
}

export function isTransientUpstreamExecutionError(error: unknown): boolean {
  return (
    error instanceof TransientUpstreamExecutionError ||
    isTransientUpstreamExecutionText(formatErrorMessage(error))
  );
}

export function buildTaskFailureError(taskId: string, context: string, detail: string): Error {
  if (isTransientUpstreamExecutionText(detail)) {
    return new TransientUpstreamExecutionError(`${context} for task ${taskId}: ${detail}`);
  }

  return new Error(`${context} for task ${taskId}: ${detail}`);
}

export async function runWithTransientUpstreamRetry(args: {
  label: string;
  scope: string;
  fn: (attempt: number) => Promise<void>;
}): Promise<boolean> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= TRANSIENT_UPSTREAM_MAX_ATTEMPTS; attempt += 1) {
    try {
      await args.fn(attempt);
      return true;
    } catch (error) {
      if (!isTransientUpstreamExecutionError(error)) {
        throw error;
      }

      lastError = error;
      const message = formatErrorMessage(error);

      if (attempt < TRANSIENT_UPSTREAM_MAX_ATTEMPTS) {
        console.warn(
          `[${args.scope}][retry ${attempt}/${TRANSIENT_UPSTREAM_MAX_ATTEMPTS}] ${args.label}: ${message}`,
        );
        await sleep(TRANSIENT_UPSTREAM_RETRY_DELAY_MS * attempt);
        continue;
      }

      if (SOFT_SKIP_TRANSIENT_UPSTREAM_FAILURE) {
        console.warn(
          `[${args.scope}][soft-skip] ${args.label}: upstream runtime remained unavailable after ${TRANSIENT_UPSTREAM_MAX_ATTEMPTS} attempt(s). ${message}`,
        );
        return false;
      }

      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(formatErrorMessage(lastError));
}