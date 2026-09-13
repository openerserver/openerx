import {
  type ByokUsageRecord,
  byokUsageQueryResultSchema,
  isByokModelRef,
} from "@openerx/contracts";

/** A historical message keeps its own model source even after the user switches settings. */
export async function localByokUsage(
  query: { conversationId?: string; messageId?: string },
  mode: "hosted" | "byok",
  read: (query: { conversationId?: string; messageId?: string }) => Promise<unknown>,
): Promise<ByokUsageRecord[] | null> {
  const local = byokUsageQueryResultSchema.parse(await read(query));
  const usesByok =
    local.selectedModelRef !== null
      ? isByokModelRef(local.selectedModelRef) || local.selectedModelRef.startsWith("byok/")
      : mode === "byok";
  return usesByok ? local.records : null;
}
