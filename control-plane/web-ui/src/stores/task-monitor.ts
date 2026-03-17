import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type TaskMonitorLayoutMode = "free" | "status" | "stage" | "time";

export interface TaskMonitorNodeLayout {
  id: string;
  taskId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  collapsed: boolean;
  detailsCollapsed?: boolean;
}

export interface TaskMonitorViewport {
  x: number;
  y: number;
  zoom: number;
}

interface TaskMonitorSavedLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

let nodeSeed = 0;

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  padding = 18,
) {
  return !(
    left.x + left.width + padding <= right.x ||
    right.x + right.width + padding <= left.x ||
    left.y + left.height + padding <= right.y ||
    right.y + right.height + padding <= left.y
  );
}

function findAvailablePosition(nodes: TaskMonitorNodeLayout[], width: number, height: number) {
  const startX = 28;
  const startY = 28;
  const gap = 28;
  const viewportWidth =
    typeof window === "undefined" ? 1440 : Math.max(window.innerWidth - 320, width + startX * 2);
  const columnCount = Math.max(1, Math.floor((viewportWidth - startX * 2 + gap) / (width + gap)));
  const columnXs = Array.from(
    { length: columnCount },
    (_, index) => startX + index * (width + gap),
  );

  const rowTolerance = 8;
  const groupedRows = nodes
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .reduce<Array<{ y: number; height: number }>>((rows, node) => {
      const rowHeight = Math.max(320, node.height);
      const lastRow = rows[rows.length - 1];
      if (lastRow && Math.abs(lastRow.y - node.y) <= rowTolerance) {
        lastRow.height = Math.max(lastRow.height, rowHeight);
        return rows;
      }

      rows.push({ y: node.y, height: rowHeight });
      return rows;
    }, []);

  const candidateRows: Array<{ y: number; height: number }> = [];
  let nextRowY = startY;

  if (groupedRows.length === 0) {
    candidateRows.push({ y: startY, height: Math.max(320, height) });
  } else {
    for (const row of groupedRows) {
      const normalizedY = Math.max(row.y, nextRowY);
      candidateRows.push({ y: normalizedY, height: Math.max(320, row.height) });
      nextRowY = normalizedY + Math.max(320, row.height) + gap;
    }
  }

  while (candidateRows.length < 200) {
    const previousRow = candidateRows[candidateRows.length - 1];
    const rowY = previousRow ? previousRow.y + previousRow.height + gap : startY;
    candidateRows.push({ y: rowY, height: Math.max(320, height) });
  }

  for (const row of candidateRows) {
    const y = row.y;
    for (const x of columnXs) {
      const candidate = { x, y, width, height };
      if (nodes.every((node) => !overlaps(candidate, node))) {
        return { x, y };
      }
    }
  }

  return {
    x: startX + nodes.length * 36,
    y: startY + nodes.length * 28,
  };
}

function nextNodeId() {
  nodeSeed += 1;
  return `tm_${Date.now().toString(36)}_${nodeSeed}`;
}

export const useTaskMonitorStore = defineStore(
  "task-monitor",
  () => {
    const nodes = ref<TaskMonitorNodeLayout[]>([]);
    const viewport = ref<TaskMonitorViewport>({ x: 0, y: 0, zoom: 1 });
    const layoutMode = ref<TaskMonitorLayoutMode>("free");
    const freeLayoutSnapshot = ref<Record<string, TaskMonitorSavedLayout>>({});
    const freeLayoutBaseline = ref<Record<string, TaskMonitorSavedLayout>>({});

    const sortedNodes = computed(() =>
      [...nodes.value].sort((left, right) => left.zIndex - right.zIndex),
    );

    function nextZIndex() {
      return nodes.value.reduce((max, node) => Math.max(max, node.zIndex), 0) + 1;
    }

    function snapshotFromNode(node: TaskMonitorNodeLayout): TaskMonitorSavedLayout {
      return {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      };
    }

    function rememberFreeLayout(nodeId: string, target: "snapshot" | "baseline") {
      const node = nodes.value.find((item) => item.id === nodeId);
      if (!node) return;
      const nextSnapshot = snapshotFromNode(node);
      if (target === "snapshot") {
        freeLayoutSnapshot.value = {
          ...freeLayoutSnapshot.value,
          [nodeId]: nextSnapshot,
        };
        return;
      }

      freeLayoutBaseline.value = {
        ...freeLayoutBaseline.value,
        [nodeId]: nextSnapshot,
      };
    }

    function getSavedFreeLayout(nodeId: string, target: "snapshot" | "baseline") {
      return target === "snapshot"
        ? freeLayoutSnapshot.value[nodeId] || null
        : freeLayoutBaseline.value[nodeId] || null;
    }

    function getNode(taskId: string) {
      return nodes.value.find((node) => node.taskId === taskId) || null;
    }

    function addTaskNode(
      taskId: string,
      options?: Partial<Omit<TaskMonitorNodeLayout, "id" | "taskId">>,
    ) {
      const existing = getNode(taskId);
      if (existing) {
        existing.zIndex = nextZIndex();
        return existing.id;
      }

      const width = options?.width ?? 350;
      const height = options?.height ?? 260;
      const autoPosition =
        options?.x == null || options?.y == null
          ? findAvailablePosition(nodes.value, width, height)
          : null;

      const node: TaskMonitorNodeLayout = {
        id: nextNodeId(),
        taskId,
        x: options?.x ?? autoPosition?.x ?? 80 + nodes.value.length * 28,
        y: options?.y ?? autoPosition?.y ?? 88 + nodes.value.length * 24,
        width,
        height,
        zIndex: options?.zIndex ?? nextZIndex(),
        collapsed: options?.collapsed ?? false,
        detailsCollapsed: options?.detailsCollapsed ?? true,
      };
      nodes.value.push(node);
      rememberFreeLayout(node.id, "snapshot");
      rememberFreeLayout(node.id, "baseline");
      return node.id;
    }

    function removeNode(nodeId: string) {
      nodes.value = nodes.value.filter((node) => node.id !== nodeId);
      const nextSnapshot = { ...freeLayoutSnapshot.value };
      delete nextSnapshot[nodeId];
      freeLayoutSnapshot.value = nextSnapshot;
      const nextBaseline = { ...freeLayoutBaseline.value };
      delete nextBaseline[nodeId];
      freeLayoutBaseline.value = nextBaseline;
    }

    function setNodePosition(nodeId: string, x: number, y: number) {
      const node = nodes.value.find((item) => item.id === nodeId);
      if (!node) return;
      node.x = x;
      node.y = y;
      node.zIndex = nextZIndex();
      if (layoutMode.value === "free") {
        rememberFreeLayout(nodeId, "snapshot");
      }
    }

    function setNodeSize(nodeId: string, width: number, height: number) {
      const node = nodes.value.find((item) => item.id === nodeId);
      if (!node) return;
      node.width = Math.max(280, Math.round(width));
      node.height = Math.max(180, Math.round(height));
      if (layoutMode.value === "free") {
        rememberFreeLayout(nodeId, "snapshot");
      }
    }

    function toggleCollapsed(nodeId: string) {
      const node = nodes.value.find((item) => item.id === nodeId);
      if (!node) return;
      node.collapsed = !node.collapsed;
      node.zIndex = nextZIndex();
    }

    function toggleDetailsCollapsed(nodeId: string) {
      const node = nodes.value.find((item) => item.id === nodeId);
      if (!node) return;
      node.detailsCollapsed = node.detailsCollapsed === false;
      node.zIndex = nextZIndex();
    }

    function bringToFront(nodeId: string) {
      const node = nodes.value.find((item) => item.id === nodeId);
      if (!node) return;
      node.zIndex = nextZIndex();
    }

    function setViewport(nextViewport: Partial<TaskMonitorViewport>) {
      viewport.value = {
        x: nextViewport.x ?? viewport.value.x,
        y: nextViewport.y ?? viewport.value.y,
        zoom: nextViewport.zoom ?? viewport.value.zoom,
      };
    }

    function setLayoutMode(nextLayoutMode: TaskMonitorLayoutMode) {
      layoutMode.value = nextLayoutMode;
    }

    function normalizeNodeWindowWidth(normalizedWidth: number) {
      let changed = false;

      for (const node of nodes.value) {
        if (node.collapsed) {
          node.collapsed = false;
          changed = true;
        }
        if (node.width !== normalizedWidth) {
          node.width = normalizedWidth;
          changed = true;
        }
      }

      return changed;
    }

    function normalizePersistedWidths(
      snapshot: Record<string, TaskMonitorSavedLayout>,
      normalizedWidth: number,
    ) {
      let changed = false;
      const nextSnapshot: Record<string, TaskMonitorSavedLayout> = { ...snapshot };

      for (const nodeId of Object.keys(nextSnapshot)) {
        const saved = nextSnapshot[nodeId];
        if (saved && saved.width !== normalizedWidth) {
          nextSnapshot[nodeId] = {
            ...saved,
            width: normalizedWidth,
          };
          changed = true;
        }
      }

      return { changed, nextSnapshot };
    }

    function normalizePersistedWindowWidth(width: number) {
      const normalizedWidth = Math.max(280, Math.round(width));
      const nodesChanged = normalizeNodeWindowWidth(normalizedWidth);
      const snapshotResult = normalizePersistedWidths(freeLayoutSnapshot.value, normalizedWidth);
      freeLayoutSnapshot.value = snapshotResult.nextSnapshot;
      const baselineResult = normalizePersistedWidths(freeLayoutBaseline.value, normalizedWidth);
      freeLayoutBaseline.value = baselineResult.nextSnapshot;

      return nodesChanged || snapshotResult.changed || baselineResult.changed;
    }

    function resetCanvas() {
      nodes.value = [];
      viewport.value = { x: 0, y: 0, zoom: 1 };
      layoutMode.value = "free";
      freeLayoutSnapshot.value = {};
      freeLayoutBaseline.value = {};
    }

    return {
      nodes,
      viewport,
      layoutMode,
      freeLayoutSnapshot,
      freeLayoutBaseline,
      sortedNodes,
      addTaskNode,
      removeNode,
      setNodePosition,
      setNodeSize,
      toggleDetailsCollapsed,
      bringToFront,
      setViewport,
      setLayoutMode,
      normalizePersistedWindowWidth,
      rememberFreeLayout,
      getSavedFreeLayout,
      resetCanvas,
      getNode,
    };
  },
  {
    persist: true,
  },
);
