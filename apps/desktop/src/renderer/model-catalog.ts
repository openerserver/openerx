import type { ModelCatalogEntry } from "@openerx/contracts";
import { automaticModelRef } from "@openerx/contracts/model";

export function resolveDefaultModel(models: readonly ModelCatalogEntry[], preferred: string) {
  const available = models.filter((model) => model.status === "available");
  return (
    available.find((model) => model.modelRef === preferred) ??
    available.find((model) => model.recommended) ??
    available.find((model) => model.modelRef === automaticModelRef) ??
    available[0]
  );
}
export function defaultModelNotice(
  models: readonly ModelCatalogEntry[],
  preferred: string,
): string | null {
  if (preferred === automaticModelRef || !models.some((model) => model.catalogVersion)) return null;
  if (models.some((model) => model.modelRef === preferred && model.status === "available"))
    return null;
  const next = resolveDefaultModel(models, preferred);
  return next
    ? `原先的默认模型已下架或当前账号无权使用，新任务将使用 ${next.displayName}。可在设置中重新选择。`
    : null;
}
