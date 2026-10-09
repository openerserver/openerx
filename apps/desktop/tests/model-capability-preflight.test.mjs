import { describe, expect, it, vi } from "vitest";
import {
  checkModelImageInput,
  inspectModelImageInput,
  runImageRecognitionTest,
} from "../scripts/model-capability-preflight.mjs";

function catalogEntry(imageInput, modelRef = "platform/test") {
  return { modelRef, status: "available", capabilities: { imageInput } };
}

describe("model image capability preflight", () => {
  it.each([true, false])(
    "records the selected model with imageInput=%s without claiming live proof",
    (imageInput) => {
      const preflight = inspectModelImageInput({
        modelRef: "platform/test",
        catalog: [catalogEntry(!imageInput, "platform/other"), catalogEntry(imageInput)],
      });
      expect(preflight).toEqual({
        modelRef: "platform/test",
        imageInput,
        evidence: "catalog",
        imageRecognitionVerified: false,
        imageRecognitionTests: imageInput ? "run" : "skip",
      });
    },
  );

  it.each([
    { modelRef: null, catalog: [catalogEntry(true)] },
    { modelRef: "platform/test", catalog: null },
    { modelRef: "platform/missing", catalog: [catalogEntry(true)] },
    { modelRef: "platform/test", catalog: [catalogEntry(true), catalogEntry(false)] },
    { modelRef: "platform/test", catalog: [catalogEntry(undefined)] },
    { modelRef: "platform/test", catalog: [catalogEntry("true")] },
    { modelRef: "platform/test", catalog: [{ ...catalogEntry(true), status: "unavailable" }] },
  ])("fails incomplete or ambiguous model configuration: %j", (snapshot) => {
    expect(() => inspectModelImageInput(snapshot)).toThrow(/MODEL_TEST_PREFLIGHT/);
  });

  it("reads the selected model and current catalog through the desktop bridge", async () => {
    const originalWindow = globalThis.window;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    globalThis.window = {
      localStorage: {
        getItem: (key) => (key === "openerx.defaultModelRef" ? "platform/test" : null),
      },
      openerx: { listModels: async () => [catalogEntry(false)] },
    };
    try {
      const result = await checkModelImageInput({ evaluate: (read) => read() }, "fixture");
      expect(result.imageInput).toBe(false);
      expect(log).toHaveBeenCalledWith(
        "MODEL_CAPABILITY_PREFLIGHT",
        expect.stringContaining('"evidence":"catalog"'),
      );
    } finally {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      log.mockRestore();
    }
  });

  it("does not call image recognition for a text-only model or count the skip as passed", async () => {
    const recognize = vi.fn();
    const preflight = inspectModelImageInput({
      modelRef: "platform/test",
      catalog: [catalogEntry(false)],
    });
    expect(await runImageRecognitionTest(preflight, "known image", recognize)).toEqual({
      name: "known image",
      status: "skipped",
      reason: "MODEL_IMAGE_INPUT_UNSUPPORTED",
    });
    expect(recognize).not.toHaveBeenCalled();
  });

  it("runs image content verification when declared supported, propagating upstream mismatches", async () => {
    const preflight = inspectModelImageInput({
      modelRef: "platform/test",
      catalog: [catalogEntry(true)],
    });
    const verify = vi.fn(async () => {});
    expect(await runImageRecognitionTest(preflight, "known image", verify)).toEqual({
      name: "known image",
      status: "passed",
    });
    expect(verify).toHaveBeenCalledOnce();
    const rejection = new Error("Upstream does not support image input");
    await expect(
      runImageRecognitionTest(preflight, "known image", async () => {
        throw rejection;
      }),
    ).rejects.toBe(rejection);
    await expect(runImageRecognitionTest({}, "unknown", verify)).rejects.toThrow(
      /MODEL_TEST_PREFLIGHT/,
    );
  });
});
