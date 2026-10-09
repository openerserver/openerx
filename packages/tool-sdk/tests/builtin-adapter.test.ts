import type { ToolOperation } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { BuiltinToolAdapter } from "../src/builtin-adapter";

const adapter = new BuiltinToolAdapter();
const calculate = (expression: string) =>
  adapter.execute({ operation: "compute", expression, idempotencyKey: "compute-regression" });
const transform = (
  action: "sort" | "select" | "unique",
  rows: Array<Record<string, unknown>>,
  fields: string[],
) =>
  adapter.execute({
    operation: "structured_data",
    action,
    rows,
    fields,
    idempotencyKey: "rows-regression",
  });

describe("builtin arithmetic", () => {
  it.each([
    ["(12 + 3) * 4 ^ 2", 240],
    ["2*-3", -6],
    ["10/-2", -5],
    ["2^-3", 0.125],
    ["2^3^2", 512],
    ["-2^2", -4],
    ["(-2)^2", 4],
    ["-2^-2", -0.25],
    ["-(2+3)*4", -20],
    ["3*-(1+2)", -9],
    ["2^-3^2", 1 / 512],
    ["2*-3^2", -18],
    ["2^(-3)^2", 512],
    ["(2^-3)^2", 0.015625],
    ["1--2", 3],
    ["1+-2", -1],
    ["--2", 2],
    ["-+-2", 2],
    ["+2", 2],
    ["2*+3", 6],
    ["2++3", 5],
    ["2^+3", 8],
    ["1.2e+3 + .5E1", 1205],
    ["7%3*2", 2],
    ["(-7)%3", -1],
    ["2-3-4", -5],
    ["16/4/2", 2],
    ["0^0", 1],
  ] as const)("evaluates %s with mathematical precedence", async (expression, expected) => {
    const result = await calculate(expression);
    expect(result.data).toEqual({ value: expected });
    expect(result.summary).toBe(String(expected));
    expect(result.sideEffectCommitted).toBe(false);
  });

  it.each([
    "",
    " ",
    "1 2 +",
    "1 2 -",
    "1 2 *",
    "1 +",
    "*2",
    "2**3",
    "2(3+4)",
    "(2)3",
    "(2)(3)",
    "()",
    "(1+)",
    "(1+2",
    "1+2)",
    "1.2.3",
    "1e",
    "1e+",
    "new Date()",
    "sqrt(4)",
    "2;3",
    "Infinity",
    "NaN",
  ])("rejects malformed or unsupported expression %j", async (expression) => {
    await expect(calculate(expression)).rejects.toThrow("COMPUTE_INVALID_EXPRESSION");
  });

  it.each(["1e309", "1e309*0", "1/0", "0/0", "1%0", "10^1000", "(-1)^.5"])(
    "rejects a non-finite literal or result in %s",
    async (expression) => {
      await expect(calculate(expression)).rejects.toThrow("COMPUTE_NON_FINITE_RESULT");
    },
  );

  it("handles deeply nested and unary expressions within the input limit without recursion", async () => {
    await expect(calculate(`${"(".repeat(999)}1${")".repeat(999)}`)).resolves.toMatchObject({
      data: { value: 1 },
    });
    await expect(calculate(`${"-".repeat(1999)}1`)).resolves.toMatchObject({ data: { value: -1 } });
  });
});

describe("builtin structured rows", () => {
  it("orders negative and fractional numbers numerically without mutating input", async () => {
    const values = [-2, 1.2, -10, 1.11, 1.02, 1.002, 0, 10, 2];
    const rows = values.map((value) => ({ value }));
    const result = await transform("sort", rows, ["value"]);
    expect(result.data).toEqual({
      rows: [-10, -2, 0, 1.002, 1.02, 1.11, 1.2, 2, 10].map((value) => ({ value })),
    });
    expect(rows.map(({ value }) => value)).toEqual(values);
  });

  it("uses later keys to break ties and preserves the order of equal rows", async () => {
    const rows = [
      { group: 2, value: -2, id: "a" },
      { group: 1, value: -2, id: "b" },
      { group: 1, value: -10, id: "c" },
      { group: 1, value: -2, id: "d" },
    ];
    await expect(transform("sort", rows, ["group", "value"])).resolves.toMatchObject({
      data: { rows: [rows[2], rows[1], rows[3], rows[0]] },
    });
  });

  it("retains natural text sorting", async () => {
    const rows = ["item10", "item2", "item1"].map((name) => ({ name }));
    await expect(transform("sort", rows, ["name"])).resolves.toMatchObject({
      data: { rows: [rows[2], rows[1], rows[0]] },
    });
  });

  it("gives missing values, numbers, and text a consistent order in mixed columns", async () => {
    const rows = [
      { value: "-2" },
      { value: -2 },
      { value: "-10" },
      { value: -10 },
      { value: null },
      {},
    ];
    await expect(transform("sort", rows, ["value"])).resolves.toMatchObject({
      data: { rows: [rows[4], rows[5], rows[3], rows[1], rows[0], rows[2]] },
    });
  });

  it("keeps selection and deduplication semantics", async () => {
    const rows = [
      { id: 1, name: "first" },
      { id: 1, name: "second" },
      { id: 2, name: "third" },
    ];
    await expect(transform("select", rows, ["name"])).resolves.toMatchObject({
      data: { rows: rows.map(({ name }) => ({ name })) },
    });
    await expect(transform("unique", rows, ["id"])).resolves.toMatchObject({
      data: { rows: [rows[0], rows[2]] },
    });
  });

  it("rejects operations outside the builtin adapter", async () => {
    await expect(adapter.execute({ operation: "web_search" } as ToolOperation)).rejects.toThrow(
      "BUILTIN_OPERATION_NOT_SUPPORTED",
    );
  });
});
