import type {
  LocalWebSearchPolicy,
  LocalWebSearchProviderDescriptor,
  LocalWebSearchProviderResult,
} from "@openerx/contracts";
import type { LocalSearchProvider, NormalizedLocalSearchQuery } from "./local-web-search";

export const FAKE_LOCAL_WEB_SEARCH_PROVIDER_DESCRIPTOR: LocalWebSearchProviderDescriptor = {
  providerId: "direct:baidu-json",
  displayName: "Deterministic fake local search",
  transport: "fake",
  stability: "fake",
  releaseEligible: false,
  requiresDailyProbe: false,
};

export class FakeLocalWebSearchProvider implements LocalSearchProvider {
  readonly descriptor = FAKE_LOCAL_WEB_SEARCH_PROVIDER_DESCRIPTOR;

  async search(
    _input: NormalizedLocalSearchQuery,
    _context: { signal: AbortSignal; policy: LocalWebSearchPolicy },
  ): Promise<LocalWebSearchProviderResult> {
    return {
      providerId: this.descriptor.providerId,
      candidates: [],
      recencyApplied: false,
      executionPerformed: false,
      responseBytes: 0,
      durationMs: 0,
    };
  }
}
