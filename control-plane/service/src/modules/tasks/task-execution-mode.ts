export type PublicTaskExecutionMode = "single" | "parallel" | "sequential-chain";
export type StoredTaskExecutionMode = "single" | "parallel" | "sequential_chain";

export function toStoredTaskExecutionMode(
  value: string | null | undefined,
): StoredTaskExecutionMode | null {
  if (value === "single" || value === "parallel") {
    return value;
  }
  if (value === "sequential-chain" || value === "sequential_chain") {
    return "sequential_chain";
  }

  return null;
}

export function fromStoredTaskExecutionMode(
  value: string | null | undefined,
): PublicTaskExecutionMode | null {
  if (value === "single" || value === "parallel") {
    return value;
  }
  if (value === "sequential-chain" || value === "sequential_chain") {
    return "sequential-chain";
  }

  return null;
}
