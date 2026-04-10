export function findUniqueConstraintMatch(
  error: unknown,
  candidateConstraints: string[],
): string | null {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    const record = error as Error & { cause?: unknown };
    return (
      matchUniqueConstraintRecord(
        {
          message: record.message,
        },
        candidateConstraints,
      ) ?? findUniqueConstraintMatch(record.cause, candidateConstraints)
    );
  }

  if (typeof error !== "object") {
    return null;
  }

  const record = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  return (
    matchUniqueConstraintRecord(record, candidateConstraints) ??
    findUniqueConstraintMatch(record.cause, candidateConstraints)
  );
}

function matchUniqueConstraintRecord(
  record: {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
  },
  candidateConstraints: string[],
) {
  const constraint = typeof record.constraint === "string" ? record.constraint : null;
  if (constraint && candidateConstraints.includes(constraint)) {
    return constraint;
  }

  const message = typeof record.message === "string" ? record.message : "";
  const matchedConstraint = candidateConstraints.find((candidate) => message.includes(candidate));
  if (matchedConstraint) {
    return matchedConstraint;
  }

  const code = typeof record.code === "string" ? record.code : null;
  if (
    candidateConstraints.length === 1 &&
    (code === "23505" || message.includes("UNIQUE constraint failed"))
  ) {
    return candidateConstraints[0] ?? null;
  }

  return null;
}