import type { DesktopBridge, ModelCatalogEntry, SkillInstallation } from "@openerx/contracts";
import {
  enterpriseWorkspaceCapabilities,
  setDesktopWorkspaceBridge,
} from "@openerx/desktop-ui/workspace-bridge";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { App } from "../../../src/renderer/App";
import "../../../src/renderer/styles.css";
import "../../../src/renderer/projects/projects.css";

const model: ModelCatalogEntry = {
  modelRef: "fixture/text-only",
  displayName: "隔离文本模型",
  version: "fixture",
  capabilities: {
    textInput: true,
    imageInput: false,
    fileInput: false,
    functionCalling: true,
    structuredOutput: true,
  },
  contextWindow: 128000,
  maxOutputTokens: 8192,
  status: "available",
  priceRef: "fixture",
  priceSummary: "合成数据，不调用模型",
  free: true,
  thinkingLevels: ["off"],
};
const bundled = ["documents", "pdf", "presentations", "spreadsheets", "structured-report"];
const skills = Array.from({ length: 18 }, (_, index) => ({
  id: `fixture-skill-${index}`,
  name: bundled[index] ?? `fixture-skill-${index}`,
  displayName: index < bundled.length ? bundled[index] : `合成企业 Skill ${index}`,
  description:
    index < bundled.length
      ? "Long package guidance must not leak into the menu summary."
      : "合成说明，用于验证很长的能力列表可以完整滚动；不读取企业账号或运行任务。",
  scope: index < bundled.length ? "builtin" : "workspace",
  enabled: true,
  packageState: "installed",
})) as SkillInstallation[];
const calls: string[] = [];
const read = {
  listModels: async () => [model],
  getModelServiceSettings: async () => ({
    mode: "hosted",
    hostedAvailable: true,
    hostedAccountId: "fixture-only",
    serverDefaultModelRef: model.modelRef,
    credentialConfigured: false,
  }),
  listConversations: async () => [],
  listProjects: async () => [],
  listSkills: async () => skills,
  getAccountState: async () => ({
    status: "signed_out",
    account: null,
    session: null,
    reason: null,
  }),
  listDesktopControlSessions: async () => [],
  onModelsChanged: () => () => undefined,
  onChatEvent: () => () => undefined,
  onAutomationRun: () => () => undefined,
  onAutomationNavigate: () => () => undefined,
  onAutomaticMemoryCreated: () => () => undefined,
  onMemoryNavigate: () => () => undefined,
};
const bridge = new Proxy(read, {
  get(target, key) {
    if (key in target) return target[key as keyof typeof target];
    return () => {
      calls.push(String(key));
      throw new Error(`UNEXPECTED_BRIDGE_CALL:${String(key)}`);
    };
  },
});
setDesktopWorkspaceBridge(
  bridge as unknown as DesktopBridge,
  undefined,
  enterpriseWorkspaceCapabilities,
);
Object.assign(window, {
  __composerLayoutFixture: {
    synthetic: true,
    calls,
    modelRef: model.modelRef,
    imageInput: model.capabilities.imageInput,
    skillCount: skills.length,
  },
});
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const root = document.getElementById("root");
if (!root) throw new Error("Composer fixture root is missing");
createRoot(root).render(
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={["/chat/new"]}>
      <App />
    </MemoryRouter>
  </QueryClientProvider>,
);
