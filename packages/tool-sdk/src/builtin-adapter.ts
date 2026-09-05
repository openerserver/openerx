import type { NormalizedToolResult, ToolOperation } from "@openerx/contracts";
import type { ToolAdapter } from "./types";

type Token =
  | { kind: "number"; value: number }
  | { kind: "operator"; value: string }
  | { kind: "paren"; value: "(" | ")" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const character = expression[index];
    if (character && "+-*/%^".includes(character)) {
      tokens.push({ kind: "operator", value: character });
      index += 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push({ kind: "paren", value: character });
      index += 1;
      continue;
    }
    throw new Error("COMPUTE_INVALID_EXPRESSION");
  }
  return tokens;
}

function calculate(expression: string): number {
  const tokens = tokenize(expression);
  const output: Token[] = [];
  const operators: Token[] = [];
  const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
  let previous: Token | undefined;
  for (const token of tokens) {
    if (token.kind === "number") output.push(token);
    else if (token.kind === "operator") {
      if (
        token.value === "-" &&
        (!previous ||
          previous.kind === "operator" ||
          (previous.kind === "paren" && previous.value === "("))
      ) {
        output.push({ kind: "number", value: 0 });
      }
      while (operators.length > 0) {
        const top = operators.at(-1);
        if (top?.kind !== "operator") break;
        const topPrecedence = precedence[top.value] ?? 0;
        const tokenPrecedence = precedence[token.value] ?? 0;
        const shouldPop =
          token.value === "^" ? topPrecedence > tokenPrecedence : topPrecedence >= tokenPrecedence;
        if (!shouldPop) break;
        output.push(operators.pop() as Token);
      }
      operators.push(token);
    } else if (token.value === "(") operators.push(token);
    else {
      while (operators.length > 0 && operators.at(-1)?.kind !== "paren")
        output.push(operators.pop() as Token);
      if (operators.pop()?.kind !== "paren") throw new Error("COMPUTE_INVALID_EXPRESSION");
    }
    previous = token;
  }
  while (operators.length > 0) {
    const token = operators.pop() as Token;
    if (token.kind === "paren") throw new Error("COMPUTE_INVALID_EXPRESSION");
    output.push(token);
  }
  const stack: number[] = [];
  for (const token of output) {
    if (token.kind === "number") stack.push(token.value);
    else if (token.kind === "operator") {
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) throw new Error("COMPUTE_INVALID_EXPRESSION");
      const result =
        token.value === "+"
          ? left + right
          : token.value === "-"
            ? left - right
            : token.value === "*"
              ? left * right
              : token.value === "/"
                ? left / right
                : token.value === "%"
                  ? left % right
                  : left ** right;
      if (!Number.isFinite(result)) throw new Error("COMPUTE_NON_FINITE_RESULT");
      stack.push(result);
    }
  }
  if (stack.length !== 1) throw new Error("COMPUTE_INVALID_EXPRESSION");
  return stack[0] as number;
}

function structured(
  operation: Extract<ToolOperation, { operation: "structured_data" }>,
): unknown[] {
  if (operation.action === "select") {
    return operation.rows.map((row) =>
      Object.fromEntries(operation.fields.map((field) => [field, row[field]])),
    );
  }
  if (operation.action === "unique") {
    const seen = new Set<string>();
    return operation.rows.filter((row) => {
      const key = JSON.stringify(operation.fields.map((field) => row[field]));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return [...operation.rows].sort((left, right) => {
    for (const field of operation.fields) {
      const compared = String(left[field] ?? "").localeCompare(
        String(right[field] ?? ""),
        "zh-CN",
        { numeric: true },
      );
      if (compared !== 0) return compared;
    }
    return 0;
  });
}

export class BuiltinToolAdapter implements ToolAdapter {
  readonly operations = ["compute", "structured_data"] as const;

  async execute(operation: ToolOperation): Promise<NormalizedToolResult> {
    if (operation.operation === "compute") {
      const value = calculate(operation.expression);
      return {
        summary: String(value),
        content: [{ type: "text", text: String(value) }],
        data: { value },
        sources: [],
        artifacts: [],
        sideEffectCommitted: false,
        durationMs: 0,
      };
    }
    if (operation.operation !== "structured_data")
      throw new Error("BUILTIN_OPERATION_NOT_SUPPORTED");
    const rows = structured(operation);
    return {
      summary: `已处理 ${rows.length} 行`,
      content: [
        {
          type: "text",
          text: `已处理 ${rows.length} 行\n${JSON.stringify(rows)}`.slice(0, 1_000_000),
        },
      ],
      data: { rows },
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 0,
    };
  }
}
