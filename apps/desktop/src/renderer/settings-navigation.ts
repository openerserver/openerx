type SearchTarget = { label: string; keywords: string; panel?: string; target?: string };
const targets: Record<string, SearchTarget[]> = {
  account: [{ label: "登录设备", keywords: "设备 登录设备 会话", target: "devices" }],
  extension: [
    {
      label: "登录设备",
      keywords: "设备 登录设备 会话 手机 连接 配对 配对码 电脑名称",
      panel: "devices",
    },
    { label: "账号与密码", keywords: "密码 登录 短信 验证码 sso 单点登录", panel: "account" },
    { label: "旧版数据", keywords: "旧版 数据 导出", panel: "data" },
  ],
  enterprise: [
    { label: "企业 Skill", keywords: "skill skills 技能", target: "skills" },
    { label: "我的安全", keywords: "安全 验证器 身份验证 恢复码", target: "security" },
    { label: "企业模型", keywords: "模型 默认模型 model", target: "models" },
  ],
  tools: [{ label: "工具", keywords: "mcp 浏览器 搜索引擎 shell 终端 目录 权限" }],
  appearance: [{ label: "外观", keywords: "主题 深色 浅色 系统 字体" }],
  assistants: [{ label: "Skill", keywords: "skill skills 技能" }],
  model: [{ label: "默认模型", keywords: "模型 model" }],
  diagnostics: [{ label: "诊断与数据", keywords: "旧版 数据 导出 日志 诊断" }],
};
export function settingsSearchTarget(section: string, query: string): SearchTarget | undefined {
  const value = query.trim().toLocaleLowerCase();
  return value
    ? targets[section]?.find((item) =>
        `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(value),
      )
    : undefined;
}

export function settingsSectionSearch(section: string, query: string, label: string): boolean {
  return (
    !query.trim() ||
    label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ||
    Boolean(settingsSearchTarget(section, query))
  );
}

export function settingsSectionUrl(search: string, section: string, target?: SearchTarget): string {
  const params = new URLSearchParams(search);
  params.set("section", section);
  params.delete("panel");
  params.delete("target");
  if (section !== "diagnostics") params.delete("legacy");
  if (target?.panel) params.set("panel", target.panel);
  if (target?.target) params.set("target", target.target);
  return params.toString();
}
