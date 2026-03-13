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
        path: "workbench",
        name: "TaskWorkbench",
        component: () => import("../pages/TaskWorkbench.vue"),
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

export default router;
