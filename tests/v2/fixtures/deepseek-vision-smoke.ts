import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  automaticModelRef,
  safeErrorMessage,
  type UsageRecord,
  type UsageStorePort,
} from "@openerx/contracts";
import {
  createDeepSeekModelCatalog,
  createDeepSeekModelExecutorFromEnv,
  deepSeekModelRefs,
  ModelGatewayService,
} from "@openerx/model-gateway";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imageData = readFileSync(
  path.join(repositoryRoot, "tests/v2/fixtures/m4/file.ocr-image.v1.png"),
).toString("base64");

try {
  const accountId = randomUUID();
  const records: UsageRecord[] = [];
  const usageStore: Pick<UsageStorePort, "record"> = {
    record(record) {
      records.push(record);
      return { record, replayed: false };
    },
  };
  const gateway = new ModelGatewayService({
    catalog: createDeepSeekModelCatalog(),
    executor: createDeepSeekModelExecutorFromEnv(),
    usageStore,
  });
  const deltas: string[] = [];
  const result = await gateway.stream(
    {
      accountId,
      conversationId: randomUUID(),
      messageId: randomUUID(),
      selectedModelRef: automaticModelRef,
      approvedFallbackModelRef: null,
      requestDedupeKey: `deepseek-vision-smoke-${randomUUID()}`,
      requirements: { imageInput: true },
      context: {
        systemPrompt: "You are a concise image-recognition test assistant.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "请简短说明图片中的主要内容。" },
              { type: "image", data: imageData, mimeType: "image/png" },
            ],
            timestamp: Date.now(),
          },
        ],
      },
    },
    (delta) => deltas.push(delta),
  );
  if (result.effectiveModelRef !== deepSeekModelRefs.vision) {
    throw new Error(`DEEPSEEK_VISION_ROUTE_INVALID:${result.effectiveModelRef}`);
  }
  if (!result.text.trim() || deltas.join("") !== result.text) {
    throw new Error("DEEPSEEK_VISION_RESPONSE_INVALID");
  }
  if (!result.usage.providerReported || records.length !== 1) {
    throw new Error("DEEPSEEK_VISION_USAGE_MISSING");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        effectiveModelRef: result.effectiveModelRef,
        text: result.text,
        stream: { deltaCount: deltas.length, reconstructedTextMatches: true },
        usage: result.usage,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(`${safeErrorMessage(error, "DeepSeek vision smoke test failed")}\n`);
  process.exitCode = 1;
}
