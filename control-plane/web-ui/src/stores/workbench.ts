import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { type WorkbenchLayoutPayload, getWorkbenchLayout, saveWorkbenchLayout } from "../lib/api";

export interface WorkbenchTaskTab {
  taskId: string;
  title?: string;
  status?: string;
  pinned?: boolean;
}

export interface WorkbenchSecondaryPane {
  taskId: string;
  sessionId?: string;
  label?: string;
}

export interface WorkbenchSnapshot {
  tabs: WorkbenchTaskTab[];
  activeTaskId: string;
  secondaryPane: WorkbenchSecondaryPane | null;
  splitMode: boolean;
}

function toLegacySnapshot(layout: WorkbenchLayoutPayload): WorkbenchSnapshot | null {
  if (Array.isArray(layout.tabs) && layout.tabs.length > 0) {
    return {
      tabs: layout.tabs.map((tab) => ({ ...tab })),
      activeTaskId: layout.activeTaskId || layout.tabs[0]?.taskId || "",
      secondaryPane: layout.secondaryPane ? { ...layout.secondaryPane } : null,
      splitMode: Boolean(layout.splitMode),
    };
  }

  if (!Array.isArray(layout.panes) || layout.panes.length === 0) {
    return null;
  }

  const taskPanes = layout.panes.filter((pane) => pane.taskId);
  if (taskPanes.length === 0) {
    return null;
  }

  const activePane = taskPanes.find((pane) => pane.id === layout.activePaneId) || taskPanes[0];
  const secondaryPane = taskPanes.find((pane) => pane.id !== activePane.id);

  return {
    tabs: taskPanes.map((pane) => ({
      taskId: pane.taskId,
      title: pane.title,
      status: pane.status,
      pinned: pane.pinned,
    })),
    activeTaskId: activePane.taskId,
    secondaryPane: secondaryPane
      ? {
          taskId: secondaryPane.taskId,
          sessionId: secondaryPane.sessionId,
          label: secondaryPane.title,
        }
      : null,
    splitMode: taskPanes.length > 1,
  };
}

export const useWorkbenchStore = defineStore(
  "workbench",
  () => {
    const tabs = ref<WorkbenchTaskTab[]>([]);
    const activeTaskId = ref("");
    const secondaryPane = ref<WorkbenchSecondaryPane | null>(null);
    const splitMode = ref(false);

    function openTask(taskId: string, title?: string, status?: string) {
      if (!taskId) {
        return;
      }

      const existing = tabs.value.find((tab) => tab.taskId === taskId);
      if (existing) {
        if (title) {
          existing.title = title;
        }
        if (status) {
          existing.status = status;
        }
      } else {
        tabs.value.push({ taskId, title, status });
      }

      activeTaskId.value = taskId;

      if (splitMode.value && !secondaryPane.value?.taskId) {
        const fallback = tabs.value.find((tab) => tab.taskId !== activeTaskId.value);
        secondaryPane.value = fallback ? { taskId: fallback.taskId } : null;
      }
    }

    function updateTaskMeta(taskId: string, payload: { title?: string; status?: string }) {
      const existing = tabs.value.find((tab) => tab.taskId === taskId);
      if (!existing) {
        return;
      }

      if (payload.title) {
        existing.title = payload.title;
      }

      if (payload.status) {
        existing.status = payload.status;
      }
    }

    function openTaskInSecondary(taskId: string, title?: string, status?: string) {
      if (!taskId) {
        return;
      }

      const previousActive = activeTaskId.value;
      openTask(taskId, title, status);

      if (previousActive && previousActive !== taskId) {
        activeTaskId.value = previousActive;
        splitMode.value = true;
        secondaryPane.value = { taskId };
        return;
      }

      if (!previousActive) {
        activeTaskId.value = taskId;
      }
    }

    function closeTask(taskId: string) {
      const tab = tabs.value.find((t) => t.taskId === taskId);
      if (tab?.pinned) return;

      tabs.value = tabs.value.filter((t) => t.taskId !== taskId);

      if (activeTaskId.value === taskId) {
        activeTaskId.value = tabs.value[0]?.taskId || "";
      }

      if (secondaryPane.value?.taskId === taskId) {
        const fallback = tabs.value.find((tab) => tab.taskId !== activeTaskId.value);
        secondaryPane.value = fallback ? { taskId: fallback.taskId } : null;
      }

      if (tabs.value.length < 2) {
        splitMode.value = false;
        secondaryPane.value = null;
      }
    }

    function setActiveTask(taskId: string) {
      if (tabs.value.some((tab) => tab.taskId === taskId)) {
        activeTaskId.value = taskId;
        if (
          splitMode.value &&
          secondaryPane.value?.taskId === taskId &&
          !secondaryPane.value?.sessionId
        ) {
          const fallback = tabs.value.find((tab) => tab.taskId !== taskId);
          secondaryPane.value = fallback ? { taskId: fallback.taskId } : null;
        }
      }
    }

    function setSecondaryPane(taskId: string, sessionId?: string, label?: string) {
      if (!taskId) {
        secondaryPane.value = null;
        return;
      }

      if (taskId === activeTaskId.value && !sessionId) {
        secondaryPane.value = null;
        return;
      }

      if (!tabs.value.some((tab) => tab.taskId === taskId)) {
        tabs.value.push({ taskId, title: label });
      }

      secondaryPane.value = { taskId, sessionId, label };
    }

    function setSplitMode(enabled: boolean) {
      splitMode.value = enabled;
      if (!enabled) {
        secondaryPane.value = null;
        return;
      }

      if (tabs.value.length < 2 && !secondaryPane.value?.sessionId) {
        splitMode.value = false;
        secondaryPane.value = null;
        return;
      }

      if (!activeTaskId.value) {
        activeTaskId.value = tabs.value[0]?.taskId || "";
      }

      if (
        !secondaryPane.value?.taskId ||
        (secondaryPane.value.taskId === activeTaskId.value && !secondaryPane.value.sessionId)
      ) {
        const fallback = tabs.value.find((tab) => tab.taskId !== activeTaskId.value);
        secondaryPane.value = fallback ? { taskId: fallback.taskId } : null;
      }
    }

    function createSnapshot(): WorkbenchSnapshot {
      return {
        tabs: tabs.value.map((tab) => ({ ...tab })),
        activeTaskId: activeTaskId.value,
        secondaryPane: secondaryPane.value ? { ...secondaryPane.value } : null,
        splitMode: splitMode.value,
      };
    }

    function resolveRestoredActiveTaskId(snapshot: WorkbenchSnapshot) {
      const activeExists = tabs.value.some((tab) => tab.taskId === snapshot.activeTaskId);
      return activeExists ? snapshot.activeTaskId : tabs.value[0]?.taskId || "";
    }

    function resolveRestoredSecondaryPane(snapshot: WorkbenchSnapshot) {
      const secondaryTaskId = snapshot.secondaryPane?.taskId || "";
      const secondaryExists = tabs.value.some((tab) => tab.taskId === secondaryTaskId);
      return secondaryExists && snapshot.secondaryPane ? { ...snapshot.secondaryPane } : null;
    }

    function normalizeSecondaryPaneAfterRestore() {
      if (secondaryPane.value?.taskId === activeTaskId.value && !secondaryPane.value.sessionId) {
        const fallback = tabs.value.find((tab) => tab.taskId !== activeTaskId.value);
        secondaryPane.value = fallback ? { taskId: fallback.taskId } : null;
      }
    }

    function applyRestoredSplitMode(snapshot: WorkbenchSnapshot) {
      splitMode.value = snapshot.splitMode;
      if (!splitMode.value) {
        secondaryPane.value = null;
        return;
      }

      if (tabs.value.length < 2 && !secondaryPane.value?.sessionId) {
        splitMode.value = false;
        secondaryPane.value = null;
      }
    }

    function restoreSnapshot(snapshot: WorkbenchSnapshot | null) {
      if (!snapshot || snapshot.tabs.length === 0) {
        clearWorkbench();
        return;
      }

      tabs.value = snapshot.tabs.map((tab) => ({ ...tab }));
      activeTaskId.value = resolveRestoredActiveTaskId(snapshot);
      secondaryPane.value = resolveRestoredSecondaryPane(snapshot);
      normalizeSecondaryPaneAfterRestore();
      applyRestoredSplitMode(snapshot);
    }

    function clearWorkbench() {
      tabs.value = [];
      activeTaskId.value = "";
      secondaryPane.value = null;
      splitMode.value = false;
    }

    function pinTask(taskId: string) {
      const tab = tabs.value.find((t) => t.taskId === taskId);
      if (tab) tab.pinned = true;
    }

    function unpinTask(taskId: string) {
      const tab = tabs.value.find((t) => t.taskId === taskId);
      if (tab) tab.pinned = false;
    }

    function closeOtherTasks(keepTaskId: string) {
      tabs.value = tabs.value.filter((t) => t.taskId === keepTaskId || t.pinned);
      if (!tabs.value.some((t) => t.taskId === activeTaskId.value)) {
        activeTaskId.value = keepTaskId;
      }
      if (
        secondaryPane.value &&
        !tabs.value.some((t) => t.taskId === secondaryPane.value?.taskId)
      ) {
        secondaryPane.value = null;
      }
      if (tabs.value.length < 2) {
        splitMode.value = false;
        secondaryPane.value = null;
      }
    }

    function closeTasksToRight(taskId: string) {
      const idx = tabs.value.findIndex((t) => t.taskId === taskId);
      if (idx < 0) return;
      tabs.value = tabs.value.filter((t, i) => i <= idx || t.pinned);
      if (!tabs.value.some((t) => t.taskId === activeTaskId.value)) {
        activeTaskId.value = tabs.value[tabs.value.length - 1]?.taskId || "";
      }
      if (
        secondaryPane.value &&
        !tabs.value.some((t) => t.taskId === secondaryPane.value?.taskId)
      ) {
        secondaryPane.value = null;
      }
      if (tabs.value.length < 2) {
        splitMode.value = false;
        secondaryPane.value = null;
      }
    }

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const serverSyncing = ref(false);

    function debouncedSaveToServer() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveWorkbenchLayout({
          tabs: tabs.value.map((t) => ({ ...t })),
          activeTaskId: activeTaskId.value,
          secondaryPane: secondaryPane.value ? { ...secondaryPane.value } : null,
          splitMode: splitMode.value,
        }).catch(() => {});
      }, 1000);
    }

    async function loadFromServer() {
      try {
        serverSyncing.value = true;
        const res = await getWorkbenchLayout();
        const layout = res.data;
        const snapshot = layout ? toLegacySnapshot(layout) : null;
        if (snapshot) {
          restoreSnapshot(snapshot);
        }
      } catch {
        // 首次使用或网络异常时忽略，保持 localStorage 状态
      } finally {
        serverSyncing.value = false;
      }
    }

    watch(
      [tabs, activeTaskId, secondaryPane, splitMode],
      () => {
        if (!serverSyncing.value) {
          debouncedSaveToServer();
        }
      },
      { deep: true },
    );

    return {
      tabs,
      activeTaskId,
      secondaryPane,
      splitMode,
      openTask,
      openTaskInSecondary,
      updateTaskMeta,
      closeTask,
      setActiveTask,
      setSecondaryPane,
      setSplitMode,
      createSnapshot,
      restoreSnapshot,
      clearWorkbench,
      pinTask,
      unpinTask,
      closeOtherTasks,
      closeTasksToRight,
      loadFromServer,
    };
  },
  {
    persist: true,
  },
);
