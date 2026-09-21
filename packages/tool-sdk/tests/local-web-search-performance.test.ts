import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { parseBaiduJsonSearchResponse, parseBingHtmlSearchResponse } from "../src";

const longExcerpt = "bounded parser fixture ".repeat(40);
const bingHtml = `<!doctype html><html><body><ol id="b_results">${Array.from(
  { length: 100 },
  (_, index) =>
    `<li class="b_algo"><h2><a href="https://example.com/docs/${index}">TypeScript documentation ${index}</a></h2><p>${longExcerpt}</p></li>`,
).join("")}</ol></body></html>`;
const baiduJson = JSON.stringify({
  feed: {
    entry: Array.from({ length: 100 }, (_, index) => ({
      title: `TypeScript documentation result ${index}`,
      url: `https://example.com/docs/${index}`,
      abs: `${longExcerpt} ${index}`,
      time: 1_787_954_400,
    })),
  },
});

function parserP95(run: () => unknown): number {
  for (let index = 0; index < 20; index += 1) run();
  const samples = Array.from({ length: 100 }, () => {
    const startedAt = performance.now();
    run();
    return performance.now() - startedAt;
  }).sort((left, right) => left - right);
  return samples[Math.ceil(samples.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

describe("local Web Search parser performance", () => {
  it("keeps Baidu JSON and Bing HTML fixture P95 below the 50 ms budget", () => {
    const baiduP95Ms = parserP95(() => parseBaiduJsonSearchResponse(baiduJson));
    const bingP95Ms = parserP95(() => parseBingHtmlSearchResponse(bingHtml, "https://cn.bing.com"));

    expect(baiduP95Ms).toBeLessThan(50);
    expect(bingP95Ms).toBeLessThan(50);
  });
});
