<template>
  <div :style="workbenchThemeStyles.page">
    <a-flex justify="space-between" align="center" :style="workbenchThemeStyles.header">
      <a-typography-title :level="3" :style="workbenchThemeStyles.title">任务 Workbench</a-typography-title>
      <a-space wrap>
        <a-radio-group :value="taskPickerTarget" size="small" button-style="solid" @update:value="handlePickerTargetChange">
          <a-radio-button value="primary">加入主窗</a-radio-button>
          <a-radio-button value="secondary">加入副窗</a-radio-button>
        </a-radio-group>
        <a-select
          :value="taskPickerValue"
          show-search
          allow-clear
          placeholder="添加任务到工作台"
          :style="workbenchThemeStyles.pickerSelect"
          :loading="taskPickerLoading"
          :filter-option="filterTaskOption"
          :option-label-prop="'title'"
          @focus="handleTaskPickerFocus"
          @update:value="handleTaskPickerChange"
        >
          <a-select-option
            v-for="option in taskPickerOptions"
            :key="option.value"
            :value="option.value"
            :title="option.displayLabel"
          >
            {{ option.label }}
          </a-select-option>
        </a-select>
        <a-button :disabled="workbench.tabs.length < 2" @click="toggleSplitMode">
          {{ workbench.splitMode ? "退出分屏" : "双栏分屏" }}
        </a-button>
        <a-radio-group
          :value="workbenchViewMode"
          size="small"
          button-style="solid"
          @update:value="handleWorkbenchViewModeChange"
        >
          <a-radio-button value="v1">经典</a-radio-button>
          <a-radio-button value="v3">V3</a-radio-button>
        </a-radio-group>
        <a-button danger :disabled="workbench.tabs.length === 0" @click="confirmClearWorkbench">
          清空工作台
        </a-button>
      </a-space>
    </a-flex>

    <a-card size="small" :body-style="workbenchThemeStyles.shellBody" :style="workbenchThemeStyles.shellCard">
      <a-empty v-if="workbench.tabs.length === 0" description="工作台还没有打开任何任务">
        <a-button type="primary" @click="openTaskList">去任务列表挑一个任务</a-button>
      </a-empty>

      <template v-else>
        <a-tabs
          class="task-workbench-tabs"
          type="editable-card"
          hide-add
          :activeKey="workbench.activeTaskId"
          @update:activeKey="handleActiveTabChange"
          @edit="handleTabEdit"
        >
          <a-tab-pane
            v-for="tab in workbench.tabs"
            :key="tab.taskId"
            :closable="workbench.tabs.length > 1 && !tab.pinned"
          >
            <template #tab>
              <a-dropdown :trigger="['contextmenu']">
                <div :style="workbenchThemeStyles.tabLabel">
                  <a-space size="small" class="task-workbench-tabs__tab-content">
                    <a-badge :status="tabStatusBadge(tab.taskId, tab.status)" />
                    <span v-if="tab.pinned" class="task-workbench-tabs__pin">📌</span>
                    <span class="task-workbench-tabs__title">{{ tabLabel(tab) }}</span>
                    <a-tag v-if="tabNeedsAttention(tab.taskId, tab.status)" color="orange" :style="workbenchThemeStyles.attentionTag">{{ tabAttentionLabel(tab.taskId, tab.status) }}</a-tag>
                  </a-space>
                </div>
                <template #overlay>
                  <a-menu @click="(info) => handleTabContextMenu(tab.taskId, String(info.key))">
                    <a-menu-item key="pin">{{ tab.pinned ? '取消固定' : '固定标签页' }}</a-menu-item>
                    <a-menu-item key="close" :disabled="tab.pinned">关闭</a-menu-item>
                    <a-menu-item key="closeOthers">关闭其他</a-menu-item>
                    <a-menu-item key="closeRight">关闭右侧</a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="newTab">在新标签页打开</a-menu-item>
                    <a-menu-item key="newWindow">在新窗口打开</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </template>
          </a-tab-pane>
        </a-tabs>

        <div
          v-if="workbench.splitMode && workbench.secondaryPane?.taskId"
          class="task-workbench-member-grid"
        >
          <TaskWorkbenchMemberStrip
            pane-label="副窗协作"
            :task-title="secondaryTaskTab?.title || workbench.secondaryPane.taskId"
            :view="secondaryTaskMemberView"
            :loading="secondaryTaskMemberLoading"
          />
        </div>

        <template v-if="!workbench.splitMode">
          <div :style="workbenchThemeStyles.pane">
            <div :style="workbenchThemeStyles.paneHeader">
              <a-space size="small" wrap>
                <a-tag color="blue">主视图</a-tag>
                <span :style="workbenchThemeStyles.paneTitle">{{ activeTab?.title || workbench.activeTaskId }}</span>
                <a-tag :color="activeTaskDisplayStatus.tagColor">{{ activeTaskDisplayStatus.label }}</a-tag>
              </a-space>
            </div>
            <iframe
              v-if="workbench.activeTaskId"
              :src="taskFrameSrc(workbench.activeTaskId)"
              :style="workbenchThemeStyles.primaryFrame"
            />
          </div>
        </template>

        <template v-else>
          <a-row :gutter="16">
            <a-col :xs="24" :xl="12">
              <div :style="workbenchThemeStyles.pane">
                <div :style="workbenchThemeStyles.paneHeader">
                  <a-space size="small" wrap>
                    <a-tag color="blue">主窗</a-tag>
                    <span :style="workbenchThemeStyles.paneTitle">{{ activeTab?.title || workbench.activeTaskId }}</span>
                  </a-space>
                </div>
                <iframe
                  v-if="workbench.activeTaskId"
                  :src="taskFrameSrc(workbench.activeTaskId)"
                  :style="workbenchThemeStyles.splitFrame"
                />
              </div>
            </a-col>

            <a-col :xs="24" :xl="12">
              <div :style="workbenchThemeStyles.pane">
                <div :style="workbenchThemeStyles.paneHeader">
                  <a-flex justify="space-between" align="center" :style="workbenchThemeStyles.secondaryHeader">
                    <a-space size="small" wrap>
                      <a-tag color="purple">副窗</a-tag>
                      <a-select
                        :value="workbench.secondaryPane?.taskId || undefined"
                        placeholder="选择副窗任务"
                        :style="workbenchThemeStyles.secondarySelect"
                        @update:value="handleSecondaryChange"
                      >
                        <a-select-option
                          v-for="tab in secondaryOptions"
                          :key="tab.taskId"
                          :value="tab.taskId"
                        >
                          {{ tab.title || tab.taskId }}
                        </a-select-option>
                      </a-select>
                      <a-tag v-if="workbench.secondaryPane?.taskId" :color="secondaryTaskDisplayStatus.tagColor">{{ secondaryTaskDisplayStatus.label }}</a-tag>
                    </a-space>
                    <a-button size="small" :disabled="!workbench.secondaryPane?.taskId" @click="promoteSecondaryToPrimary">
                      设为主窗
                    </a-button>
                  </a-flex>
                </div>

                <div v-if="!workbench.secondaryPane?.taskId" :style="workbenchThemeStyles.emptyPane">
                  <a-empty description="再打开一个任务，就可以双栏并行查看" />
                </div>
                <iframe
                  v-else
                  :src="taskFrameSrc(workbench.secondaryPane.taskId, workbench.secondaryPane.sessionId)"
                  :style="workbenchThemeStyles.splitFrame"
                />
              </div>
            </a-col>
          </a-row>
        </template>
      </template>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { Button, Modal, message, notification } from "ant-design-vue";
import type { DefaultOptionType } from "ant-design-vue/es/select";
import { computed, defineAsyncComponent, h, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type Task,
  type TaskMemberViewModel,
  type TaskTreeTaskMeta,
  getTaskMemberView,
  getTaskTreeMeta,
  listTasks,
  toApiError,
} from "../lib/api";
import { resolveTaskDisplayStatus } from "../lib/task-display-status";
import { useProjectStore } from "../stores/project";
import { useWorkbenchStore } from "../stores/workbench";
import { workbenchThemeStyles } from "../theme/ui-theme";

const TaskWorkbenchMemberStrip = defineAsyncComponent(
  () => import("../components/task-detail/TaskWorkbenchMemberStrip.vue"),
);

const route = useRoute();
const router = useRouter();
const workbench = useWorkbenchStore();
const projectStore = useProjectStore();
const taskPickerValue = ref<string | undefined>(undefined);
const taskPickerTarget = ref<"primary" | "secondary">("primary");
const taskPickerLoading = ref(false);
const taskPickerTasks = ref<Task[]>([]);
const taskMetaMap = ref<Record<string, TaskTreeTaskMeta>>({});
const taskMemberViewMap = ref<Record<string, TaskMemberViewModel | null>>({});
const taskMemberLoadingMap = ref<Record<string, boolean>>({});
const clearUndoNotificationKey = "workbench-clear-undo";
let tabRefreshTimer: ReturnType<typeof setInterval> | null = null;
const missingTaskNoticeShown = ref(false);

const requestedTaskIds = computed(() => {
  const value = route.query.task;
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
});

const activeTab = computed(() =>
  workbench.tabs.find((tab) => tab.taskId === workbench.activeTaskId),
);

const secondaryOptions = computed(() =>
  workbench.tabs.filter((tab) => tab.taskId !== workbench.activeTaskId),
);

const activeTaskMeta = computed(() => {
  const taskId = workbench.activeTaskId;
  return taskId ? taskMetaMap.value[taskId] : undefined;
});

const activeTaskDisplayStatus = computed(() =>
  resolveTaskDisplayStatus(activeTaskMeta.value || { status: activeTab.value?.status }),
);

const secondaryTaskMeta = computed(() => {
  const taskId = workbench.secondaryPane?.taskId;
  return taskId ? taskMetaMap.value[taskId] : undefined;
});

const secondaryTaskTab = computed(() => {
  const taskId = workbench.secondaryPane?.taskId;
  return taskId ? workbench.tabs.find((tab) => tab.taskId === taskId) : undefined;
});

const secondaryTaskMemberView = computed(() => {
  const taskId = workbench.secondaryPane?.taskId;
  return taskId ? taskMemberViewMap.value[taskId] || null : null;
});

const secondaryTaskMemberLoading = computed(() => {
  const taskId = workbench.secondaryPane?.taskId;
  return taskId ? taskMemberLoadingMap.value[taskId] === true : false;
});

const secondaryTaskDisplayStatus = computed(() =>
  resolveTaskDisplayStatus(
    secondaryTaskMeta.value || { status: secondaryOptions.value[0]?.status },
  ),
);

const taskPickerOptions = computed(() =>
  taskPickerTasks.value
    .filter((task) => !workbench.tabs.some((tab) => tab.taskId === task.id))
    .map((task) => ({
      value: task.id,
      label: `${formatTaskPickerTitle(task.title || task.id, 28)} · ${resolveTaskDisplayStatus(task).label} · ${task.id.slice(0, 8)}`,
      displayLabel: formatTaskPickerTitle(task.title || task.id, 20),
    })),
);

watch(
  requestedTaskIds,
  (taskIds) => {
    for (const taskId of taskIds) {
      workbench.openTask(taskId);
      void ensureTaskMeta(taskId);
    }
  },
  { immediate: true },
);

watch(
  () => projectStore.currentProjectId,
  () => {
    taskPickerTasks.value = [];
    void reloadTaskPicker();
  },
  { immediate: true },
);

watch(
  () => workbench.tabs.map((tab) => tab.taskId),
  (taskIds) => {
    for (const taskId of taskIds) {
      void ensureTaskMeta(taskId);
    }

    if (taskIds.length > 0 && !tabRefreshTimer) {
      tabRefreshTimer = setInterval(() => {
        void refreshOpenTabMeta();
        void refreshFocusedTaskMemberViews(true);
      }, 10000);
    }

    if (taskIds.length === 0 && tabRefreshTimer) {
      clearInterval(tabRefreshTimer);
      tabRefreshTimer = null;
    }
  },
  { immediate: true },
);

watch(
  () => [workbench.activeTaskId, workbench.secondaryPane?.taskId],
  () => {
    void refreshFocusedTaskMemberViews();
  },
  { immediate: true },
);

onUnmounted(() => {
  if (tabRefreshTimer) {
    clearInterval(tabRefreshTimer);
    tabRefreshTimer = null;
  }
});

async function ensureTaskMeta(taskId: string) {
  const existing = workbench.tabs.find((tab) => tab.taskId === taskId);
  if (existing?.title && existing?.status && taskMetaMap.value[taskId]) {
    return;
  }

  try {
    const task = await getTaskTreeMeta(taskId);
    taskMetaMap.value = { ...taskMetaMap.value, [taskId]: task };
    workbench.updateTaskMeta(taskId, {
      title: task.title ?? undefined,
      status: task.status ?? undefined,
    });
  } catch (error) {
    if (toApiError(error)?.status === 404) {
      handleMissingTask(taskId);
    }
    // Ignore title lookup failures in workbench shell.
  }
}

async function refreshOpenTabMeta() {
  const taskIds = workbench.tabs.map((tab) => tab.taskId);
  await Promise.all(
    taskIds.map(async (taskId) => {
      try {
        const task = await getTaskTreeMeta(taskId);
        taskMetaMap.value = { ...taskMetaMap.value, [taskId]: task };
        workbench.updateTaskMeta(taskId, {
          title: task.title ?? undefined,
          status: task.status ?? undefined,
        });
      } catch (error) {
        if (toApiError(error)?.status === 404) {
          handleMissingTask(taskId);
          return;
        }
        // Ignore transient refresh failures.
      }
    }),
  );
}

async function ensureTaskMemberView(taskId: string, force = false) {
  if (!taskId) {
    return;
  }
  if (!force && (taskMemberLoadingMap.value[taskId] || taskMemberViewMap.value[taskId])) {
    return;
  }

  taskMemberLoadingMap.value = { ...taskMemberLoadingMap.value, [taskId]: true };
  try {
    const view = await getTaskMemberView(taskId);
    taskMemberViewMap.value = { ...taskMemberViewMap.value, [taskId]: view };
  } catch (error) {
    if (toApiError(error)?.status === 404) {
      handleMissingTask(taskId);
    }
    taskMemberViewMap.value = { ...taskMemberViewMap.value, [taskId]: null };
  } finally {
    taskMemberLoadingMap.value = { ...taskMemberLoadingMap.value, [taskId]: false };
  }
}

async function refreshFocusedTaskMemberViews(force = false) {
  const taskIds =
    workbench.splitMode && workbench.secondaryPane?.taskId ? [workbench.secondaryPane.taskId] : [];
  await Promise.all(taskIds.map((taskId) => ensureTaskMemberView(taskId, force)));
}

function handleMissingTask(taskId: string) {
  workbench.pruneMissingTasks([taskId]);

  if (!missingTaskNoticeShown.value) {
    missingTaskNoticeShown.value = true;
    message.warning(
      "已自动清理当前数据库中不存在的历史任务标签。若需查看旧历史，请让 UI 指向对应的 app 数据库实例。",
    );
  }
}

async function reloadTaskPicker() {
  if (!projectStore.currentProjectId) {
    taskPickerTasks.value = [];
    return;
  }

  taskPickerLoading.value = true;
  try {
    const response = await listTasks(projectStore.currentProjectId);
    taskPickerTasks.value = response.data || [];
    taskMetaMap.value = {
      ...taskMetaMap.value,
      ...Object.fromEntries((response.data || []).map((task) => [task.id, task])),
    };
  } catch {
    taskPickerTasks.value = [];
  } finally {
    taskPickerLoading.value = false;
  }
}

function handleTaskPickerFocus() {
  if (taskPickerTasks.value.length === 0 && !taskPickerLoading.value) {
    void reloadTaskPicker();
  }
}

function handleTaskPickerChange(value: unknown) {
  if (value == null || Array.isArray(value)) {
    taskPickerValue.value = undefined;
    return;
  }

  const taskId = String(value);
  const task = taskPickerTasks.value.find((item) => item.id === taskId);
  if (task) {
    taskMetaMap.value = { ...taskMetaMap.value, [taskId]: task };
  }

  if (
    taskPickerTarget.value === "secondary" &&
    workbench.activeTaskId &&
    workbench.activeTaskId !== taskId
  ) {
    workbench.openTaskInSecondary(taskId, task?.title, task?.status);
    workbench.setSplitMode(true);
  } else {
    workbench.openTask(taskId, task?.title, task?.status);
  }

  taskPickerValue.value = undefined;
}

function handlePickerTargetChange(value: unknown) {
  taskPickerTarget.value = value === "secondary" ? "secondary" : "primary";
}

function filterTaskOption(input: string, option?: DefaultOptionType) {
  const keyword = input.toLowerCase();
  const optionValue = option?.value == null ? "" : String(option.value).toLowerCase();
  const optionLabel = option?.label == null ? "" : String(option.label).toLowerCase();
  return optionValue.includes(keyword) || optionLabel.includes(keyword);
}

function formatTaskPickerTitle(title: string, maxLength: number) {
  if (title.length <= maxLength) {
    return title;
  }

  return `${title.slice(0, Math.max(0, maxLength - 1))}…`;
}

function tabStatusBadge(
  taskId?: string,
  status?: string,
): "success" | "processing" | "warning" | "error" | "default" {
  return resolveTaskDisplayStatus(taskId ? taskMetaMap.value[taskId] || { status } : { status })
    .badgeStatus;
}

function tabNeedsAttention(taskId?: string, status?: string) {
  return resolveTaskDisplayStatus(taskId ? taskMetaMap.value[taskId] || { status } : { status })
    .needsAttention;
}

function tabAttentionLabel(taskId?: string, status?: string) {
  const displayStatus = resolveTaskDisplayStatus(
    taskId ? taskMetaMap.value[taskId] || { status } : { status },
  );
  return displayStatus.status === "awaiting-adoption" ? displayStatus.label : "未完成";
}

const workbenchViewMode = ref<"v1" | "v3">("v1");

function handleWorkbenchViewModeChange(value: string | number | boolean) {
  workbenchViewMode.value = value === "v3" ? "v3" : "v1";
}

function taskFrameSrc(taskId: string, sessionId?: string) {
  const query = new URLSearchParams({ embedded: "1", workbench: "1" });
  if (sessionId) {
    query.set("session", sessionId);
  }
  const suffix = workbenchViewMode.value === "v3" ? "/v3" : "";
  return `/tasks/${taskId}${suffix}?${query.toString()}`;
}

function tabLabel(tab: { taskId: string; title?: string }) {
  return tab.title || `任务 ${tab.taskId.slice(0, 8)}`;
}

function handleActiveTabChange(taskId: string | number) {
  workbench.setActiveTask(String(taskId));
}

function handleTabEdit(
  targetKey: string | number | MouseEvent | KeyboardEvent,
  action: "add" | "remove",
) {
  if (action !== "remove") {
    return;
  }

  workbench.closeTask(String(targetKey));
}

function handleTabContextMenu(taskId: string, action: string) {
  switch (action) {
    case "pin":
      if (workbench.tabs.find((t) => t.taskId === taskId)?.pinned) {
        workbench.unpinTask(taskId);
      } else {
        workbench.pinTask(taskId);
      }
      break;
    case "close":
      workbench.closeTask(taskId);
      break;
    case "closeOthers":
      workbench.closeOtherTasks(taskId);
      break;
    case "closeRight":
      workbench.closeTasksToRight(taskId);
      break;
    case "newTab":
      window.open(`/tasks/${taskId}`, "_blank");
      break;
    case "newWindow":
      window.open(
        `/tasks/${taskId}`,
        "_blank",
        "width=1200,height=800,menubar=no,toolbar=no,location=no,status=no",
      );
      break;
  }
}

function toggleSplitMode() {
  if (workbench.tabs.length < 2 && !workbench.splitMode) {
    message.info("至少打开两个任务后才能进入双栏分屏");
    return;
  }

  workbench.setSplitMode(!workbench.splitMode);
}

function handleSecondaryChange(taskId: unknown) {
  if (taskId == null || Array.isArray(taskId)) {
    workbench.setSecondaryPane("");
    return;
  }

  workbench.setSecondaryPane(String(taskId));
}

function promoteSecondaryToPrimary() {
  if (!workbench.secondaryPane?.taskId) {
    return;
  }

  const currentPrimary = workbench.activeTaskId;
  workbench.setActiveTask(workbench.secondaryPane.taskId);
  if (currentPrimary && currentPrimary !== workbench.activeTaskId) {
    workbench.setSecondaryPane(currentPrimary);
  }
}

function handleWorkbenchMessage(event: MessageEvent) {
  const payload = event.data;
  if (!payload || typeof payload !== "object") {
    return;
  }

  const data = payload as Record<string, unknown>;
  if (data.type !== "workbench:open-fork") {
    return;
  }

  const taskId = typeof data.taskId === "string" ? data.taskId : "";
  const sessionId = typeof data.sessionId === "string" ? data.sessionId : undefined;
  const label = typeof data.title === "string" ? data.title : undefined;
  if (!taskId || !sessionId) {
    return;
  }

  workbench.setSecondaryPane(taskId, sessionId, label);
  workbench.setSplitMode(true);
}

window.addEventListener("message", handleWorkbenchMessage);

function confirmClearWorkbench() {
  if (workbench.tabs.length === 0) {
    return;
  }

  const snapshot = workbench.createSnapshot();
  const tabCount = snapshot.tabs.length;
  const willExitSplit = snapshot.splitMode;

  Modal.confirm({
    title: "确认清空工作台？",
    content: `将关闭 ${tabCount} 个任务标签${willExitSplit ? "，并退出双栏分屏" : ""}。你仍可在通知里立即撤销。`,
    okText: "清空工作台",
    okType: "danger",
    cancelText: "取消",
    onOk() {
      workbench.clearWorkbench();
      showClearUndoNotice(snapshot);
    },
  });
}

function showClearUndoNotice(snapshot: ReturnType<typeof workbench.createSnapshot>) {
  notification.warning({
    key: clearUndoNotificationKey,
    message: "工作台已清空",
    placement: "topRight",
    duration: 10,
    description: h("div", { style: { paddingRight: "4px", color: "#5c4734", lineHeight: 1.7 } }, [
      h("div", `刚刚关闭了 ${snapshot.tabs.length} 个任务标签。`),
      h(
        "div",
        snapshot.splitMode ? "双栏分屏状态也已一并清除。" : "你可以继续从任务列表重新打开任务。",
      ),
      h("div", { style: { marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" } }, [
        h(
          Button,
          {
            type: "primary",
            size: "small",
            onClick: () => {
              workbench.restoreSnapshot(snapshot);
              notification.close(clearUndoNotificationKey);
              message.success("工作台已恢复");
            },
          },
          { default: () => "撤销" },
        ),
        h(
          Button,
          {
            size: "small",
            onClick: () => {
              notification.close(clearUndoNotificationKey);
            },
          },
          { default: () => "知道了" },
        ),
      ]),
    ]),
  });
}

function openTaskList() {
  void router.push("/tasks");
}

onUnmounted(() => {
  window.removeEventListener("message", handleWorkbenchMessage);
});
</script>

<style scoped>
.task-workbench-member-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.task-workbench-tabs {
  min-width: 0;
}

.task-workbench-tabs__tab-content {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  flex-wrap: nowrap;
}

.task-workbench-tabs__pin {
  flex: 0 0 auto;
  margin-right: 2px;
}

.task-workbench-tabs__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-workbench-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 12px;
}

.task-workbench-tabs :deep(.ant-tabs-nav-wrap) {
  min-width: 0;
}

.task-workbench-tabs :deep(.ant-tabs-nav-list) {
  flex-wrap: nowrap;
}

.task-workbench-tabs :deep(.ant-tabs-tab) {
  flex: 0 0 auto;
  min-width: 0;
  max-width: min(320px, calc(100vw - 240px));
}

.task-workbench-tabs :deep(.ant-tabs-tab-btn) {
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 960px) {
  .task-workbench-member-grid {
    grid-template-columns: 1fr;
  }

  .task-workbench-tabs :deep(.ant-tabs-tab) {
    max-width: min(220px, calc(100vw - 120px));
  }
}
</style>
