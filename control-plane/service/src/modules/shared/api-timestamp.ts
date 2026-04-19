type TimestampLike = string | null | undefined;

export function normalizeApiTimestamp(value: TimestampLike) {
  if (!value) {
    return value ?? null;
  }

  const timestamp = new Date(value);

  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

export function normalizeApiTimestampFields<
  T extends Record<string, unknown>,
  K extends keyof T,
>(record: T, fields: readonly K[]) {
  const normalized = { ...record } as T;

  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" || value == null) {
      normalized[field] = normalizeApiTimestamp(value as TimestampLike) as T[K];
    }
  }

  return normalized;
}