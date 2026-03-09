import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { listProjects, type Project } from "../lib/api";

export const useProjectStore = defineStore(
  "project",
  () => {
    const currentProjectId = ref("");
    const projects = ref<Project[]>([]);
    const loading = ref(false);

    const currentProject = computed(() =>
      projects.value.find((project) => project.id === currentProjectId.value),
    );

    async function loadProjects(orgId?: string) {
      loading.value = true;
      try {
        projects.value = await listProjects(orgId);
        if (
          !currentProjectId.value ||
          !projects.value.some((project) => project.id === currentProjectId.value)
        ) {
          currentProjectId.value = projects.value[0]?.id || "";
        }
      } catch {
        projects.value = [];
      } finally {
        loading.value = false;
      }
    }

    function switchProject(projectId: string) {
      if (projects.value.some((project) => project.id === projectId)) {
        currentProjectId.value = projectId;
      }
    }

    function addProject(project: Project) {
      projects.value = [...projects.value, project];
      if (!currentProjectId.value) {
        currentProjectId.value = project.id;
      }
    }

    function updateProjectInList(updated: Partial<Project> & { id: string }) {
      projects.value = projects.value.map((project) =>
        project.id === updated.id ? { ...project, ...updated } : project,
      );
    }

    return {
      currentProjectId,
      projects,
      loading,
      currentProject,
      loadProjects,
      switchProject,
      addProject,
      updateProjectInList,
    };
  },
  {
    persist: {
      pick: ["currentProjectId"],
    },
  },
);
