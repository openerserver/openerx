import type {
  AutomationDefinition,
  AutomationRun,
  ConversationSummary,
  DesktopBridge,
} from "@openerx/contracts";
import {
  enterpriseWorkspaceCapabilities,
  setDesktopWorkspaceBridge,
} from "@openerx/desktop-ui/workspace-bridge";
import { QueryClient, QueryClientProvider, type UseQueryResult } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AutomationsPage } from "../../../src/renderer/AutomationsPage";
import { ProjectSidebar } from "../../../src/renderer/projects/ProjectSidebar";
import "../../../src/renderer/styles.css";
import "../../../src/renderer/projects/projects.css";

const query = new URLSearchParams(location.search);
const now = "2026-10-09T00:00:00.000Z";
const definition: AutomationDefinition = {
  id: "fixture-automation",
  ownerProfileId: "fixture-owner",
  name: "隔离回归：每日项目检查",
  prompt: query.has("long") ? "检查合成摘要并整理进展。\n".repeat(80) : "检查合成摘要并整理进展。",
  kind: "standalone",
  status: "active",
  schedule: { mode: "rrule", expression: "FREQ=DAILY", timezone: "Asia/Shanghai", startAt: now },
  target: { conversationId: null, branchId: null, workspaceGrantIds: [] },
  execution: {
    modelRef: "fixture/text",
    thinkingLevel: "off",
    skillInstallationId: null,
    maxConcurrentRuns: 1,
    catchUpPolicy: "skip",
    retryPolicy: "none",
  },
  nextRunAt: now,
  lastRunAt: now,
  createdAt: now,
  updatedAt: now,
  revision: 1,
};
const runs = Array.from({ length: 10 }, (_, index) => ({
  id: `run-${index}`,
  automationId: definition.id,
  scheduledFor: new Date(Date.parse(now) - index * 86_400_000).toISOString(),
  trigger: "schedule",
  status: "succeeded",
  conversationId: `fixture-chat-${index}`,
  branchId: null,
})) as unknown as AutomationRun[];
const calls: string[] = [];
const bridge = new Proxy(
  {
    listProjects: async () => [],
    listAutomations: async () => (query.has("empty") ? [] : [definition]),
    listAutomationRuns: async () => runs,
    getLoginStartupSettings: async () => ({ supported: false, openAtLogin: false }),
    listConversations: async () => [],
  },
  {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target];
      return () => {
        calls.push(String(key));
        throw Error(`UNEXPECTED_BRIDGE_CALL:${String(key)}`);
      };
    },
  },
);
setDesktopWorkspaceBridge(
  bridge as unknown as DesktopBridge,
  undefined,
  enterpriseWorkspaceCapabilities,
);
Object.assign(window, { __modalLayoutFixture: { synthetic: true, calls } });
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const page = query.has("project") ? (
  <div className="app-shell">
    <aside className="sidebar">
      <ProjectSidebar
        conversations={
          { data: [], isSuccess: true } as unknown as UseQueryResult<ConversationSummary[]>
        }
      />
    </aside>
    <main className="new-chat-page">
      <h1>隔离回归聊天背景</h1>
      <form className="composer">
        <textarea placeholder="背景聊天输入框" />
      </form>
    </main>
  </div>
) : query.has("shell") ? (
  <div className="app-shell">
    <aside className="sidebar">
      <p>隔离回归工作区</p>
    </aside>
    <AutomationsPage defaultModelRef="fixture/text" />
  </div>
) : (
  <AutomationsPage defaultModelRef="fixture/text" />
);
const container = document.getElementById("root");
if (!container) throw new Error("Layout fixture root is missing");
createRoot(container).render(
  <QueryClientProvider client={client}>
    <BrowserRouter>{page}</BrowserRouter>
  </QueryClientProvider>,
);
