import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { createProductToolSearch } from "../src/tool-search";

describe("deferred product tool search", () => {
  it("activates only matching registered tools", async () => {
    const noop = async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} });
    const calculate = defineTool({
      name: "openerx_calculate",
      label: "Calculate",
      description: "deterministic arithmetic calculator",
      parameters: Type.Object({}),
      execute: noop,
    });
    const browser = defineTool({
      name: "openerx_browser",
      label: "Browser",
      description: "navigate a website",
      parameters: Type.Object({}),
      execute: noop,
    });
    let active = ["openerx_tool_search"];
    const search = createProductToolSearch([calculate, browser], {
      active: () => active,
      activate: (names) => {
        active = names;
      },
    });
    const result = await search.execute(
      "search-call",
      { query: "arithmetic calculator" },
      undefined,
      undefined,
      {} as never,
    );
    expect(active).toEqual(["openerx_tool_search", "openerx_calculate"]);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("openerx_calculate"),
    });
  });
});
