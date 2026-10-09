export interface ModelImageInputPreflight {
  readonly modelRef: string;
  readonly imageInput: boolean;
  readonly evidence: "catalog";
  readonly imageRecognitionVerified: false;
  readonly imageRecognitionTests: "run" | "skip";
}
export function inspectModelImageInput(input: {
  catalog: unknown;
  modelRef: unknown;
}): ModelImageInputPreflight;
export function checkModelImageInput(
  page: unknown,
  suite: string,
): Promise<ModelImageInputPreflight>;
export function runImageRecognitionTest(
  preflight: ModelImageInputPreflight,
  name: string,
  verify: () => void | Promise<void>,
): Promise<
  | { name: string; status: "skipped"; reason: "MODEL_IMAGE_INPUT_UNSUPPORTED" }
  | { name: string; status: "passed" }
>;
