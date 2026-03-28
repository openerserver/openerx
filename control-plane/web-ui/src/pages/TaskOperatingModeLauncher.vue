<template>
  <div style="padding: 24px">
    <a-page-header
      :title="project ? `${project.name} / 推荐场景` : '推荐场景'"
      sub-title="任务创建前，从平台推荐场景中选择一组运行模式，并直接带入任务创建器"
      @back="router.push(`/projects/${projectId}`)"
    >
      <template #extra>
        <a-space wrap>
          <a-button @click="router.push(`/projects/${projectId}`)">项目概览</a-button>
          <a-button type="primary" @click="router.push(`/projects/${projectId}/operating-mode`)">项目运行档位</a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-spin :spinning="loading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon style="margin-bottom: 16px" :message="loadError" />

      <template v-else>
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :xl="8">
            <a-card title="项目当前默认档位" size="small">
              <a-descriptions :column="1" bordered size="small">
                <a-descriptions-item label="协作模式">{{ project?.settings?.collaborationMode || '未配置' }}</a-descriptions-item>
                <a-descriptions-item label="自动托管">{{ project?.settings?.autopilotLevel || '未配置' }}</a-descriptions-item>
                <a-descriptions-item label="管理介入">{{ project?.settings?.bossParticipationMode || '未配置' }}</a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>

          <a-col :xs="24" :xl="16">
            <a-card title="推荐场景" size="small">
              <a-empty v-if="recommendedProfiles.length === 0" description="当前平台还没有配置推荐场景" />
              <a-list v-else :data-source="recommendedProfiles" item-layout="vertical">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <template #actions>
                      <a-button type="primary" size="small" @click="handleUseScenario(item.scenarioKey)">带入新建任务</a-button>
                    </template>
                    <a-list-item-meta :title="item.scenarioKey" :description="`${item.collaborationMode} / ${item.autopilotLevel} / ${item.bossParticipationMode}`" />
                    <div style="margin-bottom: 8px">{{ item.reason }}</div>
                    <a-space wrap>
                      <a-tag v-for="templateId in item.templateHints || []" :key="templateId" color="blue">模板 {{ templateId }}</a-tag>
                      <a-tag v-for="roleHint in item.requiredRoleHints || []" :key="roleHint">{{ roleHint }}</a-tag>
                    </a-space>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </a-col>
        </a-row>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type Project,
  type RecommendedOperatingProfile,
  getOrchestrationStrategy,
  getProject,
  toApiError,
} from "../lib/api";

const route = useRoute();
const router = useRouter();
const projectId = String(route.params.projectId || "");

const loading = ref(true);
const loadError = ref("");
const project = ref<Project | null>(null);
const recommendedProfiles = ref<RecommendedOperatingProfile[]>([]);

async function loadData() {
  loading.value = true;
  loadError.value = "";
  try {
    const [projectResult, strategyResult] = await Promise.all([
      getProject(projectId),
      getOrchestrationStrategy(),
    ]);
    project.value = projectResult;
    recommendedProfiles.value = strategyResult.data.organizationSettings?.recommendedProfiles || [];
  } catch (error) {
    loadError.value =
      toApiError(error)?.message || (error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

function handleUseScenario(scenarioKey: string) {
  void router.push({
    path: "/tasks",
    query: {
      projectId,
      scenarioKey,
      openCreate: "1",
    },
  });
}

onMounted(loadData);
</script>