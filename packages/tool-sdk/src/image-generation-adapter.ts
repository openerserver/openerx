import type { NormalizedToolResult, ToolOperation } from "@openerx/contracts";
import { normalizedToolResultSchema } from "@openerx/contracts";
import type { ImageGenerationTransport, ToolAdapter } from "./types";

export class HttpPlatformImageGenerationTransport implements ImageGenerationTransport {
  constructor(
    private readonly platformBaseUrl: string,
    private readonly accessToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async generate(input: {
    prompt: string;
    aspectRatio: "1:1" | "3:2" | "2:3" | "16:9" | "9:16";
    count: number;
    signal: AbortSignal;
  }): Promise<NormalizedToolResult> {
    const response = await this.fetchImplementation(
      new URL("/v1/tools/image-generation", this.platformBaseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: input.prompt,
          aspectRatio: input.aspectRatio,
          count: input.count,
        }),
        signal: input.signal,
      },
    );
    if (!response.ok) throw new Error(`IMAGE_GENERATION_HTTP_${response.status}`);
    return normalizedToolResultSchema.parse(await response.json());
  }
}

export class ImageGenerationAdapter implements ToolAdapter {
  readonly operations = ["image_generate"] as const;
  constructor(private readonly transport: ImageGenerationTransport) {}

  async execute(
    operation: ToolOperation,
    context: { signal: AbortSignal },
  ): Promise<NormalizedToolResult> {
    if (operation.operation !== "image_generate") {
      throw new Error("IMAGE_GENERATION_OPERATION_NOT_SUPPORTED");
    }
    return await this.transport.generate({
      prompt: operation.prompt,
      aspectRatio: operation.aspectRatio,
      count: operation.count,
      signal: context.signal,
    });
  }
}
