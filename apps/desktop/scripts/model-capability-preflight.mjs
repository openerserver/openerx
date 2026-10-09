export function inspectModelImageInput({ catalog, modelRef }) {
  if (!Array.isArray(catalog) || typeof modelRef !== "string" || !modelRef.trim()) {
    throw new Error("MODEL_TEST_PREFLIGHT: selected model and current catalog are required");
  }
  const matches = catalog.filter((model) => model?.modelRef === modelRef);
  if (matches.length !== 1) {
    throw new Error(`MODEL_TEST_PREFLIGHT: selected model is missing or ambiguous: ${modelRef}`);
  }
  const model = matches[0];
  if (model.status !== "available" || typeof model.capabilities?.imageInput !== "boolean") {
    throw new Error(
      `MODEL_TEST_PREFLIGHT: model availability or image capability is unknown: ${modelRef}`,
    );
  }
  return Object.freeze({
    modelRef,
    imageInput: model.capabilities.imageInput,
    evidence: "catalog",
    imageRecognitionVerified: false,
    imageRecognitionTests: model.capabilities.imageInput ? "run" : "skip",
  });
}

export async function checkModelImageInput(page, suite) {
  const snapshot = await page.evaluate(async () => ({
    modelRef: window.localStorage.getItem("openerx.defaultModelRef"),
    catalog: await window.openerx.listModels(),
  }));
  const preflight = inspectModelImageInput(snapshot);
  console.log("MODEL_CAPABILITY_PREFLIGHT", JSON.stringify({ suite, ...preflight }));
  return preflight;
}

export async function runImageRecognitionTest(preflight, name, verify) {
  if (typeof preflight?.imageInput !== "boolean") {
    throw new Error("MODEL_TEST_PREFLIGHT: image capability must be checked before recognition");
  }
  if (!preflight.imageInput) {
    return { name, status: "skipped", reason: "MODEL_IMAGE_INPUT_UNSUPPORTED" };
  }
  // Rejections and failed content assertions must propagate as failures, never unsupported skips.
  await verify();
  return { name, status: "passed" };
}
