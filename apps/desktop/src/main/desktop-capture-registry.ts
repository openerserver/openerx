import { randomUUID } from "node:crypto";

export interface DesktopCaptureRecord {
  captureId: string;
  application: string;
  bundleId: string | null;
  windowTitle: string;
  nativeApplication: string | null;
  nativeProcessId: number | null;
  nativeWindowId: number | null;
  imageWidth: number;
  imageHeight: number;
  createdAt: number;
}

interface DesktopCaptureInput {
  application: string;
  bundleId?: string;
  windowTitle: string;
  nativeApplication?: string;
  nativeProcessId?: number;
  nativeWindowId?: number;
  imageWidth: number;
  imageHeight: number;
}

interface DesktopCaptureResolution {
  captureId: string;
  application: string;
  bundleId: string;
  x?: number;
  y?: number;
}

function normalized(value: string): string {
  return value.trim().normalize("NFC");
}

export class DesktopCaptureRegistry {
  readonly #captures = new Map<string, DesktopCaptureRecord>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 60_000,
    private readonly maximumEntries = 32,
  ) {}

  record(input: DesktopCaptureInput): DesktopCaptureRecord {
    const record: DesktopCaptureRecord = {
      captureId: randomUUID(),
      application: normalized(input.application),
      bundleId: input.bundleId ? normalized(input.bundleId) : null,
      windowTitle: normalized(input.windowTitle),
      nativeApplication: input.nativeApplication ? normalized(input.nativeApplication) : null,
      nativeProcessId: input.nativeProcessId ?? null,
      nativeWindowId: input.nativeWindowId ?? null,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
      createdAt: this.now(),
    };
    if (
      !Number.isInteger(record.imageWidth) ||
      !Number.isInteger(record.imageHeight) ||
      record.imageWidth <= 0 ||
      record.imageHeight <= 0
    ) {
      throw new Error("DESKTOP_CAPTURE_DIMENSIONS_INVALID");
    }
    if (
      (record.nativeProcessId !== null &&
        (!Number.isInteger(record.nativeProcessId) || record.nativeProcessId <= 0)) ||
      (record.nativeWindowId !== null &&
        (!Number.isInteger(record.nativeWindowId) || record.nativeWindowId <= 0))
    ) {
      throw new Error("DESKTOP_CAPTURE_IDENTITY_INVALID");
    }
    this.#captures.set(record.captureId, record);
    while (this.#captures.size > this.maximumEntries) {
      const oldest = this.#captures.keys().next().value;
      if (typeof oldest !== "string") break;
      this.#captures.delete(oldest);
    }
    return structuredClone(record);
  }

  resolve(input: DesktopCaptureResolution): DesktopCaptureRecord {
    const record = this.#captures.get(input.captureId);
    if (!record) throw new Error("DESKTOP_CAPTURE_REQUIRED");
    if (this.now() - record.createdAt > this.ttlMs) {
      this.#captures.delete(record.captureId);
      throw new Error("DESKTOP_CAPTURE_EXPIRED");
    }
    if (record.application !== normalized(input.application)) {
      throw new Error("DESKTOP_CAPTURE_APPLICATION_MISMATCH");
    }
    if (!record.bundleId) throw new Error("DESKTOP_CAPTURE_IDENTITY_MISSING");
    if (record.bundleId !== normalized(input.bundleId)) {
      throw new Error("DESKTOP_CAPTURE_IDENTITY_MISMATCH");
    }
    if ((input.x === undefined) !== (input.y === undefined)) {
      throw new Error("DESKTOP_COORDINATES_REQUIRED");
    }
    if (
      input.x !== undefined &&
      input.y !== undefined &&
      (input.x < 0 || input.y < 0 || input.x >= record.imageWidth || input.y >= record.imageHeight)
    ) {
      throw new Error("DESKTOP_COORDINATES_OUTSIDE_CAPTURE");
    }
    return structuredClone(record);
  }

  clear(): void {
    this.#captures.clear();
  }
}
