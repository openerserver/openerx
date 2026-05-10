import { type RouteRecordRaw, createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "Login",
    component: () => import("../pages/Login.vue"),
  },
  {
    path: "/",
    component: () => import("../layouts/MainLayout.vue"),
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        name: "Dashboard",
        component: () => import("../pages/Dashboard.vue"),
      },
      {
        path: "tasks",
        name: "Tasks",
        component: () => import("../pages/Tasks.vue"),
      },
      {
        path: "crowdsourced",
        name: "CrowdsourcedDevelopment",
        component: () => import("../pages/CrowdsourcedDevelopment.vue"),
      },
      {
        path: "workbench",
        name: "TaskWorkbench",
        component: () => import("../pages/TaskWorkbench.vue"),
      },
      {
        path: "multi-task-monitor",
        name: "MultiTaskMonitor",
        component: () => import("../pages/MultiTaskMonitor.vue"),
      },
      {
        path: "tasks/:taskId",
        name: "TaskDetailV3",
        component: () => import("../pages/TaskDetailV3.vue"),
      },
      {
        path: "tasks/:taskId/v3",
        redirect: (to) => ({
          name: "TaskDetailV3",
          params: to.params,
          query: to.query,
        }),
      },
      {
        path: "tasks/:taskId/operating-console",
        name: "TaskOperatingConsole",
        component: () => import("../pages/TaskOperatingConsole.vue"),
      },
      {
        path: "tasks/:taskId/operating-override",
        name: "TaskOperatingOverride",
        component: () => import("../pages/TaskOperatingOverride.vue"),
      },
      {
        path: "projects",
        name: "Projects",
        component: () => import("../pages/Projects.vue"),
      },
      {
        path: "projects/:projectId",
        name: "ProjectDetail",
        component: () => import("../pages/ProjectDetail.vue"),
      },
      {
        path: "projects/:projectId/approval-policies",
        name: "ProjectApprovalPolicies",
        component: () => import("../pages/ProjectPolicies.vue"),
      },
      {
        path: "projects/:projectId/policies",
        name: "ProjectPolicies",
        redirect: (to) => ({
          name: "ProjectApprovalPolicies",
          params: to.params,
          query: to.query,
        }),
      },
      {
        path: "projects/:projectId/role-execution",
        name: "ProjectRoleExecution",
        component: () => import("../pages/ProjectRoleExecution.vue"),
      },
      {
        path: "projects/:projectId/workflow",
        name: "ProjectWorkflowTemplate",
        component: () => import("../pages/ProjectWorkflowTemplate.vue"),
      },
      {
        path: "projects/:projectId/orchestration",
        name: "ProjectOrchestration",
        component: () => import("../pages/ProjectOrchestration.vue"),
      },
      {
        path: "projects/:projectId/task-graph",
        name: "ProjectTaskGraph",
        component: () => import("../pages/ProjectTaskGraph.vue"),
      },
      {
        path: "projects/:projectId/operating-mode",
        name: "ProjectOperatingMode",
        component: () => import("../pages/ProjectOperatingMode.vue"),
      },
      {
        path: "projects/:projectId/management-operations",
        name: "ManagementOperationsCenter",
        component: () => import("../pages/ManagementOperationsCenter.vue"),
      },
      {
        path: "projects/:projectId/boss-operations",
        name: "BossOperationsCenter",
        redirect: (to) => ({
          name: "ManagementOperationsCenter",
          params: to.params,
          query: to.query,
        }),
      },
      {
        path: "projects/:projectId/recommended-scenarios",
        name: "RecommendedScenarios",
        component: () => import("../pages/RecommendedScenarios.vue"),
      },
      {
        path: "projects/:projectId/operating-mode-launcher",
        redirect: (to) => ({
          name: "RecommendedScenarios",
          params: to.params,
          query: to.query,
        }),
      },
      {
        path: "projects/:projectId/cost",
        name: "ProjectCost",
        component: () => import("../pages/ProjectCost.vue"),
      },
      {
        path: "approvals",
        name: "Approvals",
        component: () => import("../pages/Approvals.vue"),
      },
      {
        path: "agents",
        name: "AgentConsole",
        component: () => import("../pages/AgentConsolePage.vue"),
      },
      {
        path: "settings",
        name: "Settings",
        component: () => import("../pages/Settings.vue"),
      },
      {
        path: "settings/organization-operating",
        name: "OrganizationOperatingSettings",
        component: () => import("../pages/OrganizationOperatingSettings.vue"),
      },
      {
        path: "settings/workflow-templates",
        name: "WorkflowTemplatesAdmin",
        component: () => import("../pages/WorkflowTemplatesAdmin.vue"),
      },
      {
        path: "settings/workflow-templates/:templateId",
        name: "WorkflowTemplateEditor",
        component: () => import("../pages/WorkflowTemplateEditor.vue"),
      },
      {
        path: "chat-settings",
        name: "ChatSettings",
        component: () => import("../pages/ChatSettings.vue"),
      },
      {
        path: "users",
        name: "Users",
        component: () => import("../pages/Users.vue"),
      },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition;
    }
    return { top: 0, left: 0 };
  },
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.token) {
    return { name: "Login" };
  }
});

router.beforeEach((to, from) => {
  if (from.query.embedded === "1" && to.path !== "/login" && to.query.embedded === undefined) {
    return {
      path: to.path,
      query: {
        ...to.query,
        embedded: "1",
      },
      hash: to.hash,
      replace: true,
    };
  }
});

export default router;
