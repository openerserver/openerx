import type { McpServerPreset } from "@openerx/contracts";

export const commonMcpPresets: readonly McpServerPreset[] = [
  {
    id: "context7",
    name: "Context7",
    description: "查阅代码库和框架的最新文档",
    url: "https://mcp.context7.com/mcp",
    auth: "none",
    hint: "可直接以匿名额度试用。已有 Context7 API Key 时，选择 Bearer 令牌并粘贴密钥。",
    documentationUrl: "https://context7.com/docs/resources/all-clients",
  },
  {
    id: "github",
    name: "GitHub",
    description: "读取仓库、Issue 和 Pull Request",
    url: "https://api.githubcopilot.com/mcp/readonly",
    auth: "bearer",
    hint: "已选择 GitHub 官方只读接口。请粘贴个人访问令牌（PAT），并为需要访问的仓库授予读取权限。",
    documentationUrl: "https://github.com/github/github-mcp-server#remote-github-mcp-server",
  },
];
