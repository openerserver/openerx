export type ComposerMenuViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function composerMenuPosition(
  anchor: { left: number; top: number; bottom: number; width: number },
  menu: { width: number; height: number },
  viewport: ComposerMenuViewport,
) {
  const margin = 8;
  const gap = 8;
  const maxWidth = Math.max(1, Math.min(320, viewport.width - margin * 2));
  const minWidth = Math.min(maxWidth, Math.max(anchor.width, 224));
  const width = Math.min(maxWidth, Math.max(minWidth, menu.width));
  const left = Math.max(
    viewport.left + margin,
    Math.min(anchor.left, viewport.left + viewport.width - margin - width),
  );
  const above = Math.max(
    0,
    Math.min(viewport.height - margin * 2, anchor.top - viewport.top - gap - margin),
  );
  const below = Math.max(
    0,
    Math.min(
      viewport.height - margin * 2,
      viewport.top + viewport.height - anchor.bottom - gap - margin,
    ),
  );
  const placement = above >= Math.min(menu.height, 320) || above >= below ? "above" : "below";
  const maxHeight = Math.max(1, Math.min(320, placement === "above" ? above : below));
  const height = Math.min(menu.height, maxHeight);
  const preferredTop = placement === "above" ? anchor.top - gap - height : anchor.bottom + gap;
  const top = Math.max(
    viewport.top + margin,
    Math.min(preferredTop, viewport.top + viewport.height - margin - height),
  );
  return { left, top, minWidth, maxWidth, maxHeight, placement };
}
