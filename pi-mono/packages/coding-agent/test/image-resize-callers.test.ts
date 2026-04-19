import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processFileArguments } from "../src/cli/file-processor.js";
import { createReadTool } from "../src/core/tools/read.js";
import * as imageResize from "../src/utils/image-resize.js";

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("image resize callers", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `image-resize-callers-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		const resizeImageSpy = vi.spyOn(imageResize, "resizeImage");
		resizeImageSpy.mockResolvedValue(null);
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("read tool returns text-only output when auto-resize cannot produce a safe image", async () => {
		const imagePath = join(testDir, "test.png");
		writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

		const tool = createReadTool(testDir);
		const result = await tool.execute("test-read-image", { path: imagePath });

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect((result.content[0] as { type: "text"; text: string }).text).toContain("Image omitted");
	});

	it("file processor omits image attachments when auto-resize cannot produce a safe image", async () => {
		const imagePath = join(testDir, "test.png");
		writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

		const result = await processFileArguments([imagePath]);

		expect(result.images).toHaveLength(0);
		expect(result.text).toContain("Image omitted");
	});
});
