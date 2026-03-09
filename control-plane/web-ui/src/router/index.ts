import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
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
        path: "tasks/:taskId",
        name: "TaskDetail",
        component: () => import("../pages/TaskDetail.vue"),
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
        path: "projects/:projectId/policies",
        name: "ProjectPolicies",
        component: () => import("../pages/ProjectPolicies.vue"),
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
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.token) {
    return { name: "Login" };
  }

  if (to.name === "Settings") {
    const role = auth.user?.role;
    const isSystemAdmin = role === "platform_admin" || role === "org_admin";
    if (!isSystemAdmin) {
      return { name: "Dashboard" };
    }
  }
});

export default router;
