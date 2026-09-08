import type {
  Artifact,
  Attachment,
  AutomaticMemoryCreatedEvent,
  BillingOverview,
  ChargeRecord,
  ChatEvent,
  ContentPreview,
  ConversationSnapshot,
  ConversationSummary,
  DeviceSession,
  LocalWebSearchProviderRuntimeState,
  LocalWebSearchSettingsSelection,
  LocalWebSearchSettingsState,
  McpServerAuthorizationState,
  McpServerConfig,
  MemoryEntry,
  MemoryKind,
  Message,
  ModelCatalogEntry,
  ModelServiceSettingsUpdate,
  PersonalFile,
  RechargeOrder,
  RefundOrder,
  ReleaseUpdateState,
  SkillInstallation,
  SyncConflict,
  ThinkingLevel,
  TokenAggregateField,
  ToolCall,
  ToolPermissionMode,
  ToolRuntimeCapability,
  ToolRuntimeReadiness,
  UsageRecord,
  WorkItem,
  WorkItemDetail,
} from "@openerx/contracts";
import {
  type ByokProviderId,
  byokProviderPresets,
  defaultByokModelConfiguration,
  defaultByokModelRef,
  isByokModelRef,
} from "@openerx/contracts";
import { automaticModelRef, defaultThinkingLevel } from "@openerx/contracts/model";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Brain,
  CaretDown,
  ChatCircle,
  Check,
  CheckCircle,
  Copy,
  Desktop,
  DeviceMobile,
  DownloadSimple,
  FileText,
  FolderSimple,
  GearSix,
  ImageSquare,
  Info,
  Lightning,
  MagnifyingGlass,
  Moon,
  Paperclip,
  PaperPlaneTilt,
  PawPrint,
  PencilSimple,
  Plus,
  QrCode,
  Receipt,
  ShieldWarning,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  Sun,
  TerminalWindow,
  ThumbsDown,
  ThumbsUp,
  UserCircle,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import remarkGfm from "remark-gfm";
import { desktopBrand } from "../../../../packages/branding/src/index";
import { AssistantCompanion, AssistantPage } from "./AssistantPage";
import { AutomationsPage } from "./AutomationsPage";
import { DesktopControlBar } from "./DesktopControlBar";
import {
  ConversationProjectBadge,
  ConversationProjectMoveDialog,
  ProjectHome,
  ProjectSidebar,
  useProject,
} from "./projects";

const suggestions = [
  "复盘最近一周 A 股行情：哪些板块最受关注，背后的驱动因素是什么？",
  "检查我选择的文件或文件夹，找出问题并给出可验证的改进方案",
  "搜索最新资料，制作一份 AI 工具选型报告，同时生成对比表格、DOCX 和汇报 PPT",
  "计算一家月营收 100 万元、成本 65 万元公司的三种增长情景，并生成可下载的 Excel 分析表",
];

const chatKeys = {
  list: (includeArchived = false) => ["chat", "list", includeArchived] as const,
  conversation: (id: string) => ["chat", "conversation", id] as const,
};

const accountKey = ["account", "state"] as const;
const billingKey = ["billing"] as const;
const themeStorageKey = "openerx.theme";
const defaultModelStorageKey = "openerx.defaultModelRef";
const assistantCompanionStorageKey = "openerx.assistant.companionEnabled";
const assistantFeatureStorageKey = "openerx.features.assistantEnabled";

type ThemePreference = "system" | "dark" | "light";
type WorkspaceAccessChoice = "read_only" | "read_write";
type WorkspaceExpiryChoice = "never" | "1h" | "24h" | "7d";

const themeOptions = [
  {
    value: "system",
    label: "跟随系统",
    description: "随 macOS 或 Windows 外观自动切换",
    icon: Desktop,
  },
  {
    value: "dark",
    label: "深色",
    description: "适合长时间专注工作的深色工作区",
    icon: Moon,
  },
  {
    value: "light",
    label: "浅色",
    description: "适合明亮环境的柔和浅色工作区",
    icon: Sun,
  },
] as const;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light";
}

function initialThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function initialDefaultModelRef(): string {
  try {
    return window.localStorage.getItem(defaultModelStorageKey) || defaultByokModelRef;
  } catch {
    return defaultByokModelRef;
  }
}

function initialAssistantCompanionEnabled(): boolean {
  try {
    return window.localStorage.getItem(assistantCompanionStorageKey) === "true";
  } catch {
    return false;
  }
}

function initialAssistantFeatureEnabled(): boolean {
  try {
    return window.localStorage.getItem(assistantFeatureStorageKey) === "true";
  } catch {
    return false;
  }
}

function resolvedTheme(preference: ThemePreference): "dark" | "light" {
  if (preference !== "system") return preference;
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function tokenValue(field: TokenAggregateField): string {
  return field.unknownRecords > 0
    ? `${field.known.toLocaleString()} + ${field.unknownRecords} 条未知`
    : field.known.toLocaleString();
}

function cny(minor: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(minor / 100);
}

function previousMonth(): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function workspaceExpiry(choice: WorkspaceExpiryChoice): string | null {
  const durations: Record<Exclude<WorkspaceExpiryChoice, "never">, number> = {
    "1h": 60 * 60_000,
    "24h": 24 * 60 * 60_000,
    "7d": 7 * 24 * 60 * 60_000,
  };
  return choice === "never" ? null : new Date(Date.now() + durations[choice]).toISOString();
}

function workspaceExpiryLabel(expiresAt: string | null): string {
  return expiresAt ? `有效期至 ${new Date(expiresAt).toLocaleString()}` : "长期有效";
}

const capabilityLabels: Record<keyof ModelCatalogEntry["capabilities"], string> = {
  textInput: "文本输入",
  imageInput: "图片",
  fileInput: "文件",
  functionCalling: "函数调用",
  structuredOutput: "结构化输出",
};

const thinkingLevelLabels: Record<ThinkingLevel, string> = {
  off: "关闭",
  minimal: "最少",
  low: "低",
  medium: "标准",
  high: "高",
  xhigh: "超高",
  max: "最大",
};

function modelThinkingLevels(model: ModelCatalogEntry): ThinkingLevel[] {
  return model.thinkingLevels ?? ["off"];
}

function preferredThinkingLevel(levels: ThinkingLevel[]): ThinkingLevel {
  return levels.includes(defaultThinkingLevel) ? defaultThinkingLevel : (levels[0] ?? "off");
}

const toolCatalog = [
  {
    namespace: "builtin",
    capability: "builtin.compute",
    name: "确定性计算",
    detail: "无网络算术计算",
  },
  {
    namespace: "builtin",
    capability: "builtin.structured_data",
    name: "结构化数据",
    detail: "排序、选择与去重",
  },
  {
    namespace: "files",
    capability: "file",
    name: "文件访问",
    detail: "读取、创建、编辑和管理本地文件与文件夹",
  },
  {
    namespace: "platform",
    capability: "web.search",
    name: "本地 Web Search",
    detail: "使用本地搜索引擎在网页中搜索信息",
  },
  {
    namespace: "platform",
    capability: "image.generate",
    name: "图像生成",
    detail: "使用 AI 生成图像并保存到本地",
  },
  {
    namespace: "local",
    capability: "browser",
    name: "浏览器操作",
    detail: "自动控制独立浏览器打开页面并完成交互",
  },
  {
    namespace: "local",
    capability: "shell",
    name: "终端",
    detail: "在本地终端中执行命令并获取输出",
  },
  {
    namespace: "local",
    capability: "desktop",
    name: "桌面控制",
    detail: "屏幕读取与逐次确认交互",
  },
  {
    namespace: "mcp",
    capability: "mcp",
    name: "MCP 服务",
    detail: "添加并连接 STDIO 或 Streamable HTTP 工具服务",
  },
] as const;

const toolRuntimeReasonLabels: Record<string, string> = {
  PLATFORM_ENDPOINT_NOT_CONFIGURED: "未配置平台服务地址",
  AUTHENTICATION_REQUIRED: "登录后可使用",
  BROWSER_HOST_UNAVAILABLE: "隔离浏览器 Host 未就绪",
  MAIN_CAPABILITY_UNAVAILABLE: "桌面 Host 未就绪",
  SHELL_OS_SANDBOX_UNAVAILABLE: "当前系统缺少安全 Shell 沙箱",
  SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE: "Codex Windows 安全沙箱尚未就绪",
  WORKSPACE_WRITE_GRANT_REQUIRED: "需先授权一个可写工作区",
  DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED: "需在系统设置中允许屏幕录制",
  DESKTOP_SCREEN_CAPTURE_STATUS_UNKNOWN: "无法确认屏幕录制权限",
  DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED: "需在系统设置中允许辅助功能",
  DESKTOP_AUTOMATION_UNAVAILABLE: "系统自动化组件不可用",
  DESKTOP_WINDOWS_NATIVE_CONTROL_UNAVAILABLE: "Windows 桌面控制尚未启用",
  DESKTOP_HELPER_MISSING: "Windows 桌面助手未安装，请使用包含助手的构建",
  DESKTOP_HELPER_UNAVAILABLE: "Windows 桌面助手暂不可用",
  DESKTOP_HELPER_INTEGRITY_FAILED: "Windows 桌面助手完整性校验失败",
  DESKTOP_SESSION_LOCKED: "请解锁 Windows 桌面后重试",
  DESKTOP_HELPER_ARCH_UNSUPPORTED: "当前桌面控制仅支持 Windows x64",
  DESKTOP_CONTROL_DISABLED: "Windows 桌面控制尚未启用",
  DESKTOP_PLATFORM_UNSUPPORTED: "当前桌面平台尚未支持",
  MCP_SERVER_CONFIGURATION_REQUIRED: "需先添加并启用 MCP 服务",
  MCP_OAUTH_AUTHORIZATION_REQUIRED: "至少一个 MCP 服务需要浏览器授权",
  MCP_PARTIALLY_UNAVAILABLE: "部分 MCP 服务当前不可用",
  MCP_NO_ENABLED_TOOLS: "已连接，但没有可调用工具",
  MCP_SERVER_UNREACHABLE: "已配置的 MCP 服务无法连接",
  MCP_CREDENTIAL_REQUIRED: "MCP 服务缺少本机凭证",
  LOCAL_SEARCH_DISABLED: "本地 Web Search 策略已关闭",
  LOCAL_SEARCH_PROVIDER_NOT_CONFIGURED: "尚未配置可用的本地搜索 Provider",
  LOCAL_SEARCH_FAKE_PROVIDER_ONLY: "当前只有测试 Provider",
  LOCAL_SEARCH_PROVIDER_UNAVAILABLE: "当前 Provider 正在退避或因结构漂移被锁定",
};

function toolRuntimeReason(reason: string | null): string | null {
  if (!reason) return null;
  return toolRuntimeReasonLabels[reason] ?? "运行状态暂不可确认";
}

const localWebSearchProviderStatusLabels: Record<
  LocalWebSearchProviderRuntimeState["status"],
  string
> = {
  available: "可用",
  backed_off: "退避中",
  schema_blocked: "结构已漂移",
  unavailable: "不可用",
};

const mcpAuthorizationLabels: Record<McpServerAuthorizationState["status"], string> = {
  not_required: "无需 OAuth",
  authorization_required: "需要浏览器授权",
  authorized: "已授权",
  unavailable: "OAuth 不可用",
};

function modelCapabilities(model: ModelCatalogEntry): string {
  return Object.entries(model.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([capability]) => capabilityLabels[capability as keyof typeof capabilityLabels])
    .join("、");
}

function conflictPayload(payload: SyncConflict["clientPayload"]): string {
  if (payload === null) return "删除";
  const title = typeof payload.title === "string" ? payload.title : null;
  return title ?? JSON.stringify(payload).slice(0, 160);
}

const messageStatusLabel: Record<Message["status"], string> = {
  pending: "准备中",
  streaming: "生成中",
  cancelling: "停止中",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  interrupted: "已中断",
};

function accountStatusLabel(status: string | undefined): string {
  switch (status) {
    case "signed_in":
      return "已登录";
    case "reauth_required":
      return "需要重新登录";
    case "unavailable":
      return "暂时不可用";
    default:
      return "未登录";
  }
}

function accountReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason === "DEVICE_SESSION_REVOKED") return "此设备的登录已失效，请重新验证邮箱。";
  if (reason === "AUTHENTICATION_REQUIRED") return `请先登录 ${desktopBrand.productName}。`;
  return "账户状态发生变化，请重新登录后再试。";
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(
    "zh-CN",
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : {
          month: "numeric",
          day: "numeric",
        },
  ).format(date);
}

function skillName(skill: SkillInstallation): string {
  const names: Record<string, string> = {
    documents: "文档",
    pdf: "PDF",
    presentations: "演示文稿",
    spreadsheets: "电子表格",
    "structured-report": "结构化报告",
  };
  return names[skill.name] ?? skill.displayName;
}

function skillDescription(skill: SkillInstallation): string {
  const descriptions: Record<string, string> = {
    documents: "创建或编辑真实 DOCX，并逐页检查视觉结果。",
    pdf: "创建或编辑真实 PDF，并逐页检查视觉结果。",
    presentations: "创建或编辑真实 PPTX，并逐张检查幻灯片。",
    spreadsheets: "创建或编辑真实 XLSX，并逐张检查工作表。",
    "structured-report": "把材料整理成包含摘要、关键发现、证据和下一步的简明报告。",
  };
  return descriptions[skill.name] ?? skill.description;
}

function userFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("SKILL_TOO_MANY_FILES")) {
    return "Skill 包含的文件过多（最多 20,000 个），请精简包内资源后重试。";
  }
  if (message.includes("SKILL_ARCHIVE_TOO_LARGE")) {
    return "Skill ZIP 超过 20 MB，请压缩或精简资源后重试。";
  }
  if (message.includes("SKILL_PACKAGE_TOO_LARGE")) {
    return "Skill 解压后的内容超过 20 MB，请精简资源后重试。";
  }
  if (message.includes("SKILL_ROOT_AMBIGUOUS")) {
    return "ZIP 根目录或其唯一的一级子目录中必须包含 SKILL.md。";
  }
  if (message.includes("SKILL_FRONTMATTER_REQUIRED")) {
    return "SKILL.md 缺少有效的 YAML frontmatter。";
  }
  if (message.includes("SKILL_MANIFEST_INVALID")) {
    return "agents/openai.yaml 包含无法识别或无效的字段，请检查 Skill 元数据。";
  }
  if (message.includes("BYOK_API_KEY_REQUIRED") || message.includes("BYOK_NOT_CONFIGURED")) {
    return "请先在“设置 → 模型”中配置并保存 OpenAI-compatible API。";
  }
  if (message.includes("BYOK_CONNECTION_FAILED:401")) {
    return "API Key 无效或已过期，请在提供商控制台重新生成后再试。";
  }
  if (message.includes("BYOK_CONNECTION_FAILED:403")) {
    return "API Key 没有调用该模型的权限，请检查提供商授权。";
  }
  if (message.includes("BYOK_CONNECTION_FAILED:404")) {
    return "API 地址或模型 ID 不存在，请检查 Base URL 和模型 ID。";
  }
  if (message.includes("BYOK_CONNECTION_FAILED:429")) {
    return "API 配额不足或请求过于频繁，请检查余额后重试。";
  }
  if (message.includes("BYOK_PRIVATE_NETWORK_FORBIDDEN")) {
    return "该远程 API 地址解析到了内网或系统保留地址，已为安全起见阻止连接。";
  }
  if (message.includes("BYOK_INSECURE_REMOTE_URL")) {
    return "远程 BYOK 地址必须使用 HTTPS；本机 localhost 可使用 HTTP。";
  }
  if (message.includes("PI_MODEL_NOT_CONFIGURED")) {
    return `默认模型暂时未就绪，${desktopBrand.productName} 正在自动恢复；请稍后重试。`;
  }
  if (message.includes("PI_PROVIDER_FAILURE") || message.includes("MODEL_PROVIDER")) {
    return "模型服务暂时没有响应，请检查网络后重试。";
  }
  if (message.includes("AUTHENTICATION_REQUIRED")) {
    return "当前处于本机模式；登录后即可使用账户同步。";
  }
  if (
    message.includes("invalid_format") ||
    message.includes("Invalid input") ||
    message.includes("Zod") ||
    message.trim().startsWith("[") ||
    message.trim().startsWith("{")
  ) {
    return fallback;
  }
  if (message.includes("UI_REQUEST_TIMEOUT")) {
    return `${fallback} 请求等待时间过长，请重试。`;
  }
  if (/^[\p{Script=Han}，。；：！？、（）\s·]+$/u.test(message) && message.length <= 120) {
    return message;
  }
  return fallback;
}

function messageFailureLabel(errorCode: string): string {
  if (errorCode === "MODEL_CAPABILITY_UNSUPPORTED") {
    return "当前模型不支持图片输入，请切换到自动或 DeepSeek V4 Flash Vision（实验）后重试。";
  }
  if (errorCode === "FILE_TOO_LARGE") {
    return "图片总大小超过视觉模型限制，请压缩图片或减少附件后重试。";
  }
  if (errorCode === "PI_MODEL_NOT_CONFIGURED") {
    return "默认模型暂时未就绪，请稍后重试。";
  }
  if (errorCode === "PI_PROVIDER_FAILURE") {
    return "模型服务暂时没有响应，请检查网络后重试。";
  }
  if (errorCode === "AUTHENTICATION_REQUIRED") {
    return "此操作需要登录，请先前往账户设置。";
  }
  return "本次生成没有完成，可以重试并保留当前内容。";
}

function withUiTimeout<T>(promise: Promise<T>, timeoutMs = 8_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("UI_REQUEST_TIMEOUT")), timeoutMs);
    void promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const sendReceiptTimeoutMs = 12_000;

function scrollMessageListToEnd(
  messageList: HTMLElement | null,
  behavior: ScrollBehavior = "auto",
): void {
  if (!messageList) return;
  if (typeof messageList.scrollTo === "function") {
    messageList.scrollTo({ top: messageList.scrollHeight, behavior });
    return;
  }
  messageList.scrollTop = messageList.scrollHeight;
}

function messageTimestamp(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const now = new Date();
  const sameDay =
    instant.getFullYear() === now.getFullYear() &&
    instant.getMonth() === now.getMonth() &&
    instant.getDate() === now.getDate();
  const date = sameDay
    ? "今天"
    : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(instant);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
  return `${date} ${time}`;
}

function elapsedTime(startedAt: string, completedAt: string | null): string | null {
  if (!completedAt) return null;
  const milliseconds = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const seconds = Math.max(1, Math.round(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function trapFocus(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

type ComposerSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type ComposerSelectGroup = {
  label: string;
  options: readonly ComposerSelectOption[];
};

function ComposerSelect({
  ariaLabel,
  className = "",
  disabled = false,
  icon,
  id,
  label,
  onChange,
  options,
  groups,
  renderNativeSelect = true,
  selectedValues,
  title,
  value,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  id?: string;
  label: string;
  onChange: (value: string) => void;
  options?: readonly ComposerSelectOption[];
  groups?: readonly ComposerSelectGroup[];
  renderNativeSelect?: boolean;
  selectedValues?: readonly string[];
  title?: string;
  value: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openingFocusRef = useRef<"selected" | "first" | "last">("selected");
  const menuId = useId();
  const normalizedGroups = useMemo(
    () => groups ?? [{ label: "", options: options ?? [] }],
    [groups, options],
  );
  const flattenedOptions = useMemo(
    () => normalizedGroups.flatMap((group) => group.options),
    [normalizedGroups],
  );
  const activeValues = useMemo(() => selectedValues ?? [value], [selectedValues, value]);
  const enabledIndexes = useMemo(
    () => flattenedOptions.flatMap((option, index) => (option.disabled ? [] : [index])),
    [flattenedOptions],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = flattenedOptions.findIndex(
      (option) => activeValues.includes(option.value) && !option.disabled,
    );
    const targetIndex =
      openingFocusRef.current === "first"
        ? enabledIndexes[0]
        : openingFocusRef.current === "last"
          ? enabledIndexes.at(-1)
          : selectedIndex >= 0
            ? selectedIndex
            : enabledIndexes[0];
    window.requestAnimationFrame(() => {
      if (targetIndex !== undefined) optionRefs.current[targetIndex]?.focus();
    });
  }, [activeValues, enabledIndexes, flattenedOptions, open]);

  const openMenu = (focus: "selected" | "first" | "last" = "selected") => {
    if (disabled || enabledIndexes.length === 0) return;
    openingFocusRef.current = focus;
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveOptionFocus = (currentIndex: number, direction: 1 | -1) => {
    const position = enabledIndexes.indexOf(currentIndex);
    const nextPosition = (position + direction + enabledIndexes.length) % enabledIndexes.length;
    const nextIndex = enabledIndexes[nextPosition];
    if (nextIndex !== undefined) optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={`composer-select ${open ? "is-open" : ""} ${className}`.trim()}
      title={title}
    >
      <button
        ref={triggerRef}
        type="button"
        className="composer-select-trigger"
        aria-label={`${ariaLabel}菜单`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowDown" ? "first" : "last");
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
      >
        {icon}
        <span className="composer-select-label">{label}</span>
        <CaretDown className="composer-select-caret" size={13} weight="bold" aria-hidden="true" />
      </button>
      {renderNativeSelect ? (
        <select
          id={id}
          className="composer-native-select"
          aria-label={ariaLabel}
          tabIndex={-1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {flattenedOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      {open ? (
        <div id={menuId} className="composer-select-menu" role="listbox" aria-label={ariaLabel}>
          {normalizedGroups.map((group, groupIndex) => {
            const offset = normalizedGroups
              .slice(0, groupIndex)
              .reduce((total, current) => total + current.options.length, 0);
            return (
              <div className="composer-select-group" key={group.label || "options"}>
                {group.label ? (
                  <span className="composer-select-group-label">{group.label}</span>
                ) : null}
                {group.options.map((option, optionIndex) => {
                  const index = offset + optionIndex;
                  const selected = activeValues.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      ref={(element) => {
                        optionRefs.current[index] = element;
                      }}
                      type="button"
                      className={`composer-select-option ${selected ? "is-selected" : ""}`}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={option.disabled || undefined}
                      disabled={option.disabled}
                      onClick={() => {
                        if (option.disabled) return;
                        if (!selected) onChange(option.value);
                        closeMenu(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          moveOptionFocus(index, event.key === "ArrowDown" ? 1 : -1);
                        } else if (event.key === "Home" || event.key === "End") {
                          event.preventDefault();
                          const target =
                            event.key === "Home" ? enabledIndexes[0] : enabledIndexes.at(-1);
                          if (target !== undefined) optionRefs.current[target]?.focus();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          closeMenu(true);
                        } else if (event.key === "Tab") {
                          closeMenu();
                        }
                      }}
                    >
                      <span className="composer-select-option-copy">
                        <strong>{option.label}</strong>
                        {option.description ? <small>{option.description}</small> : null}
                      </span>
                      <span className="composer-select-check" aria-hidden="true">
                        {selected ? <Check size={15} weight="bold" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pending = false,
  children,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {children}
      </div>
      <div className="confirmation-dialog-actions">
        <button ref={cancelButtonRef} type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="danger-action" disabled={pending} onClick={onConfirm}>
          {pending ? "处理中…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }): React.JSX.Element {
  const normalized = query.trim();
  if (!normalized) return <>{text}</>;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "ig"));
  let offset = 0;
  return (
    <>
      {parts.map((part) => {
        const key = `${offset}-${part}`;
        offset += part.length;
        return part.toLocaleLowerCase() === normalized.toLocaleLowerCase() ? (
          <mark key={key}>{part}</mark>
        ) : (
          <span key={key}>{part}</span>
        );
      })}
    </>
  );
}

const imageFileFormats = new Set<PersonalFile["format"]>(["gif", "jpeg", "png", "webp"]);

function AttachmentCard({
  file,
  placement,
  onRemove,
}: {
  file: PersonalFile;
  placement: "composer" | "message";
  onRemove?: () => void;
}): React.JSX.Element {
  const imageFile = imageFileFormats.has(file.format);
  const preview = useQuery({
    queryKey: ["files", "image-preview", file.id],
    queryFn: () => window.openerx.previewFile({ personalFileId: file.id }),
    enabled: imageFile,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return (
    <li
      className={`attachment-card attachment-card-${placement} ${imageFile ? "attachment-card-image" : ""}`}
    >
      <div
        className="attachment-visual"
        aria-hidden={preview.data?.imageDataUrl ? undefined : true}
      >
        {preview.data?.imageDataUrl ? (
          <img src={preview.data.imageDataUrl} alt={file.displayName} />
        ) : imageFile ? (
          <ImageSquare size={24} weight="regular" />
        ) : (
          <FileText size={24} weight="regular" />
        )}
      </div>
      <div className="attachment-copy">
        <strong title={file.displayName}>{file.displayName}</strong>
        <span>
          {file.format.toUpperCase()} · {formatBytes(file.sizeBytes)}
        </span>
      </div>
      {onRemove ? (
        <button
          type="button"
          className="attachment-remove"
          aria-label={`移除附件 ${file.displayName}`}
          onClick={onRemove}
        >
          <X size={13} weight="bold" />
        </button>
      ) : null}
    </li>
  );
}

function Composer({
  conversationId,
  conversationSnapshot,
  onOpenContext,
  contextOpen = false,
  defaultModelRef = automaticModelRef,
  projectId,
}: {
  conversationId?: string;
  conversationSnapshot?: ConversationSnapshot;
  onOpenContext?: () => void;
  contextOpen?: boolean;
  defaultModelRef?: string;
  projectId?: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [skillInstallationId, setSkillInstallationId] = useState("");
  const [newConversationModelRef, setNewConversationModelRef] = useState(defaultModelRef);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(defaultThinkingLevel);
  const [newConversationPermissionMode, setNewConversationPermissionMode] =
    useState<ToolPermissionMode>("ask");
  const [pendingFiles, setPendingFiles] = useState<PersonalFile[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const previousConversationIdRef = useRef(conversationId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) return;
    previousConversationIdRef.current = conversationId;
    setPendingFiles([]);
    setAttachmentNotice(null);
  }, [conversationId]);
  useEffect(() => {
    if (!conversationId) setNewConversationModelRef(defaultModelRef);
  }, [conversationId, defaultModelRef]);
  const chooseFiles = useMutation({
    mutationFn: () => window.openerx.chooseFiles({ conversationId: null }),
    onSuccess: async (selectedFiles) => {
      if (selectedFiles.length > 0) {
        setPendingFiles((current) => {
          const merged = new Map(current.map((file) => [file.id, file]));
          for (const file of selectedFiles) merged.set(file.id, file);
          return [...merged.values()];
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["files"] });
      setAttachmentNotice(
        selectedFiles.length > 0
          ? `已选择 ${selectedFiles.length} 个附件，将随本条消息发送。`
          : "未新增附件。",
      );
    },
  });
  const skills = useQuery({
    queryKey: ["skills", "composer"],
    queryFn: () => window.openerx.listSkills(),
    retry: false,
  });
  const models = useQuery({
    queryKey: ["models", "catalog"],
    queryFn: () => window.openerx.listModels(),
    retry: false,
  });
  const permissionMode = useQuery({
    queryKey: ["tools", "permission-mode", conversationId],
    queryFn: () => {
      if (!conversationId) throw new Error("CONVERSATION_REQUIRED");
      return window.openerx.getToolPermissionMode({ conversationId });
    },
    enabled: Boolean(conversationId),
  });
  const selectPermissionMode = useMutation({
    mutationFn: async (mode: ToolPermissionMode) => {
      if (!conversationId) {
        setNewConversationPermissionMode(mode);
        return null;
      }
      return await window.openerx.setToolPermissionMode({ conversationId, mode });
    },
    onSuccess: (state) => {
      if (!state || !conversationId) return;
      queryClient.setQueryData(["tools", "permission-mode", conversationId], state);
      void queryClient.invalidateQueries({ queryKey: ["tools", "scopes"] });
    },
  });
  const conversation = conversationSnapshot?.conversation;
  const compatibleConversationModels = conversation
    ? models.data?.filter(
        ({ modelRef }) =>
          isByokModelRef(modelRef) === isByokModelRef(conversation.selectedModelRef),
      )
    : undefined;
  const selectedConversationModel = compatibleConversationModels?.find(
    ({ modelRef }) => modelRef === conversation?.selectedModelRef,
  );
  const conversationThinkingLevels = selectedConversationModel
    ? modelThinkingLevels(selectedConversationModel)
    : conversation
      ? [conversation.thinkingLevel]
      : [defaultThinkingLevel];
  const selectConversationModel = useMutation({
    mutationFn: async (modelRef: string) => {
      if (!conversation) throw new Error("CONVERSATION_REQUIRED");
      const updated = await window.openerx.selectConversationModel({
        conversationId: conversation.id,
        modelRef,
      });
      const nextModel = models.data?.find((model) => model.modelRef === modelRef);
      if (!nextModel) return updated;
      const levels = modelThinkingLevels(nextModel);
      if (levels.includes(updated.thinkingLevel)) return updated;
      return await window.openerx.selectConversationThinkingLevel({
        conversationId: conversation.id,
        thinkingLevel: preferredThinkingLevel(levels),
      });
    },
    onSuccess: (updated) => {
      if (!conversation) return;
      queryClient.setQueryData<ConversationSnapshot>(
        chatKeys.conversation(conversation.id),
        (current) => (current ? { ...current, conversation: updated } : current),
      );
    },
  });
  const selectConversationThinking = useMutation({
    mutationFn: async (nextThinkingLevel: ThinkingLevel) => {
      if (!conversation) throw new Error("CONVERSATION_REQUIRED");
      return await window.openerx.selectConversationThinkingLevel({
        conversationId: conversation.id,
        thinkingLevel: nextThinkingLevel,
      });
    },
    onSuccess: (updated) => {
      if (!conversation) return;
      queryClient.setQueryData<ConversationSnapshot>(
        chatKeys.conversation(conversation.id),
        (current) => (current ? { ...current, conversation: updated } : current),
      );
    },
  });
  const newConversationModel =
    models.data?.find(
      ({ modelRef, status }) => modelRef === newConversationModelRef && status === "available",
    ) ??
    models.data?.find(({ modelRef }) => modelRef === automaticModelRef) ??
    models.data?.find(({ status }) => status === "available") ??
    models.data?.[0];
  const newConversationModelRequiresConfiguration =
    !conversationId && newConversationModel?.status === "unavailable";
  const selectedPermissionMode = conversationId
    ? selectPermissionMode.isPending
      ? selectPermissionMode.variables
      : permissionMode.data?.mode
    : newConversationPermissionMode;
  const newConversationThinkingLevels = useMemo(
    () =>
      newConversationModel ? modelThinkingLevels(newConversationModel) : [defaultThinkingLevel],
    [newConversationModel],
  );
  useEffect(() => {
    if (
      conversationId ||
      !newConversationModel ||
      newConversationThinkingLevels.includes(thinkingLevel)
    ) {
      return;
    }
    setThinkingLevel(preferredThinkingLevel(newConversationThinkingLevels));
  }, [conversationId, newConversationModel, newConversationThinkingLevels, thinkingLevel]);
  const send = useMutation({
    mutationFn: (text: string) =>
      withUiTimeout(
        window.openerx.sendMessage({
          conversationId: conversationId ?? null,
          ...(!conversationId && projectId ? { projectId } : {}),
          text,
          idempotencyKey: idempotencyKey("send"),
          ...(!conversationId
            ? { thinkingLevel, modelRef: newConversationModel?.modelRef ?? newConversationModelRef }
            : {}),
          ...(pendingFiles.length > 0 ? { personalFileIds: pendingFiles.map(({ id }) => id) } : {}),
          ...(skillInstallationId ? { skillInstallationId } : {}),
          ...(selectedPermissionMode ? { permissionMode: selectedPermissionMode } : {}),
        }),
        sendReceiptTimeoutMs,
      ),
    onSuccess: async (receipt) => {
      setDraft("");
      setPendingFiles([]);
      setAttachmentNotice(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat"] }),
        queryClient.invalidateQueries({ queryKey: ["files"] }),
      ]);
      if (!conversationId) navigate(`/chat/${receipt.conversationId}`);
    },
  });
  const selectedSkill = skills.data?.find(({ id }) => id === skillInstallationId);

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        const text = draft.trim();
        if (text && !send.isPending && !newConversationModelRequiresConfiguration) {
          send.mutate(text);
        }
      }}
    >
      <label htmlFor={`message-${conversationId ?? "new"}`}>发送消息</label>
      {pendingFiles.length > 0 ? (
        <ul className="composer-attachments" aria-label="待发送附件">
          {pendingFiles.map((file) => (
            <AttachmentCard
              key={file.id}
              file={file}
              placement="composer"
              onRemove={() => {
                setPendingFiles((current) => current.filter(({ id }) => id !== file.id));
                setAttachmentNotice(`已从本条消息移除 ${file.displayName}。`);
              }}
            />
          ))}
        </ul>
      ) : null}
      <textarea
        id={`message-${conversationId ?? "new"}`}
        rows={3}
        placeholder="输入你的需求…"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            const text = draft.trim();
            if (text && !send.isPending && !newConversationModelRequiresConfiguration) {
              send.mutate(text);
            }
          }
        }}
      />
      <div className="composer-actions">
        <div className="composer-tools">
          <button
            type="button"
            className="icon-button"
            aria-label="添加附件"
            onClick={() => chooseFiles.mutate()}
            disabled={chooseFiles.isPending}
          >
            <Paperclip size={18} weight="regular" />
          </button>
          <ComposerSelect
            className={`composer-footer-control composer-permission-select ${
              selectedPermissionMode === "full_access" ? "is-full-access" : ""
            }`}
            ariaLabel="权限模式"
            icon={<ShieldWarning size={15} weight="regular" />}
            label={selectedPermissionMode === "full_access" ? "完全访问" : "请求审批"}
            value={selectedPermissionMode ?? "ask"}
            disabled={
              selectPermissionMode.isPending ||
              (Boolean(conversationId) && permissionMode.isPending)
            }
            options={[
              { value: "ask", label: "请求审批", description: "工具越出授权范围时先询问" },
              {
                value: "full_access",
                label: "完全访问",
                description: "当前对话中不再逐次询问",
              },
            ]}
            title={
              selectedPermissionMode === "full_access"
                ? "当前对话中的工具无需逐次审批"
                : "工具越出已授权范围时请求审批"
            }
            onChange={(nextValue) => selectPermissionMode.mutate(nextValue as ToolPermissionMode)}
          />
          {!conversationId ? (
            <>
              <ComposerSelect
                className="composer-footer-control composer-model-thinking-select"
                ariaLabel="模型与思考"
                icon={<Lightning size={15} weight="fill" />}
                label={`${newConversationModel?.displayName ?? "选择模型"} · ${thinkingLevelLabels[thinkingLevel]}`}
                value={`model:${newConversationModel?.modelRef ?? newConversationModelRef}`}
                selectedValues={[
                  `model:${newConversationModel?.modelRef ?? newConversationModelRef}`,
                  `thinking:${thinkingLevel}`,
                ]}
                disabled={!newConversationModel}
                renderNativeSelect={false}
                groups={[
                  {
                    label: "模型",
                    options: (models.data ?? []).map((model) => ({
                      value: `model:${model.modelRef}`,
                      label: model.displayName,
                      description:
                        model.status === "available"
                          ? `${modelCapabilities(model)} · 上下文 ${model.contextWindow.toLocaleString()}`
                          : "当前不可用",
                      disabled: model.status !== "available",
                    })),
                  },
                  {
                    label: "思考强度",
                    options: newConversationThinkingLevels.map((level) => ({
                      value: `thinking:${level}`,
                      label: thinkingLevelLabels[level],
                    })),
                  },
                ]}
                onChange={(nextValue) => {
                  if (nextValue.startsWith("model:")) {
                    setNewConversationModelRef(nextValue.slice("model:".length));
                  } else if (nextValue.startsWith("thinking:")) {
                    setThinkingLevel(nextValue.slice("thinking:".length) as ThinkingLevel);
                  }
                }}
              />
              <select
                className="composer-native-select"
                aria-label="新任务模型"
                tabIndex={-1}
                value={newConversationModel?.modelRef ?? newConversationModelRef}
                disabled={!newConversationModel}
                onChange={(event) => setNewConversationModelRef(event.target.value)}
              >
                {(models.data ?? []).map((model) => (
                  <option
                    key={model.modelRef}
                    value={model.modelRef}
                    disabled={model.status !== "available"}
                  >
                    {model.displayName}
                  </option>
                ))}
              </select>
              <select
                id="thinking-level-new"
                className="composer-native-select"
                aria-label="新任务思考强度"
                tabIndex={-1}
                value={thinkingLevel}
                disabled={!newConversationModel}
                onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}
              >
                {newConversationThinkingLevels.map((level) => (
                  <option value={level} key={level}>
                    {thinkingLevelLabels[level]}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {conversation ? (
            <>
              <ComposerSelect
                className="composer-footer-control composer-model-thinking-select"
                ariaLabel="模型与思考"
                icon={<Lightning size={15} weight="fill" />}
                label={`${selectedConversationModel?.displayName ?? "后续消息模型"} · ${thinkingLevelLabels[conversation.thinkingLevel]}`}
                value={`model:${conversation.selectedModelRef}`}
                selectedValues={[
                  `model:${conversation.selectedModelRef}`,
                  `thinking:${conversation.thinkingLevel}`,
                ]}
                disabled={
                  selectConversationModel.isPending ||
                  selectConversationThinking.isPending ||
                  !selectedConversationModel
                }
                renderNativeSelect={false}
                groups={[
                  {
                    label: "模型",
                    options: (compatibleConversationModels ?? []).map((model) => ({
                      value: `model:${model.modelRef}`,
                      label: model.displayName,
                      description:
                        model.status === "available"
                          ? `${modelCapabilities(model)} · 上下文 ${model.contextWindow.toLocaleString()}`
                          : "当前不可用",
                      disabled: model.status !== "available",
                    })),
                  },
                  {
                    label: "思考强度",
                    options: [
                      ...(!conversationThinkingLevels.includes(conversation.thinkingLevel)
                        ? [
                            {
                              value: `thinking:${conversation.thinkingLevel}`,
                              label: thinkingLevelLabels[conversation.thinkingLevel],
                              disabled: true,
                            },
                          ]
                        : []),
                      ...conversationThinkingLevels.map((level) => ({
                        value: `thinking:${level}`,
                        label: thinkingLevelLabels[level],
                      })),
                    ],
                  },
                ]}
                title={
                  selectedConversationModel
                    ? `${modelCapabilities(selectedConversationModel)} · 上下文 ${selectedConversationModel.contextWindow.toLocaleString()}`
                    : undefined
                }
                onChange={(nextValue) => {
                  if (nextValue.startsWith("model:")) {
                    selectConversationModel.mutate(nextValue.slice("model:".length));
                  } else if (nextValue.startsWith("thinking:")) {
                    selectConversationThinking.mutate(
                      nextValue.slice("thinking:".length) as ThinkingLevel,
                    );
                  }
                }}
              />
              <select
                className="composer-native-select"
                aria-label="后续消息模型"
                tabIndex={-1}
                value={conversation.selectedModelRef}
                disabled={selectConversationModel.isPending}
                onChange={(event) => selectConversationModel.mutate(event.target.value)}
              >
                {(compatibleConversationModels ?? []).map((model) => (
                  <option
                    key={model.modelRef}
                    value={model.modelRef}
                    disabled={model.status !== "available"}
                  >
                    {model.displayName}
                  </option>
                ))}
              </select>
              <select
                className="composer-native-select"
                aria-label="后续消息思考强度"
                tabIndex={-1}
                value={conversation.thinkingLevel}
                disabled={selectConversationThinking.isPending || !selectedConversationModel}
                onChange={(event) =>
                  selectConversationThinking.mutate(event.target.value as ThinkingLevel)
                }
              >
                {!conversationThinkingLevels.includes(conversation.thinkingLevel) ? (
                  <option value={conversation.thinkingLevel} disabled>
                    {thinkingLevelLabels[conversation.thinkingLevel]}
                  </option>
                ) : null}
                {conversationThinkingLevels.map((level) => (
                  <option value={level} key={level}>
                    {thinkingLevelLabels[level]}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <ComposerSelect
            className="composer-footer-control composer-skill-select"
            id={`skill-${conversationId ?? "new"}`}
            ariaLabel="选择 Skill"
            icon={<Sparkle size={15} weight="regular" />}
            label={selectedSkill ? skillName(selectedSkill) : "自动 Skill"}
            value={skillInstallationId}
            options={[
              {
                value: "",
                label: "自动 Skill",
                description: `由 ${desktopBrand.productName} 根据任务自动选择`,
              },
              ...(skills.data ?? [])
                .filter(({ enabled, packageState }) => enabled && packageState === "installed")
                .map((skill) => ({
                  value: skill.id,
                  label: skillName(skill),
                  description: skill.description,
                })),
            ]}
            onChange={setSkillInstallationId}
          />
          {onOpenContext ? (
            <button
              type="button"
              className={`composer-footer-control composer-context ${contextOpen ? "is-active" : ""}`}
              aria-label="切换上下文"
              onClick={onOpenContext}
            >
              <SidebarSimple size={15} weight="regular" />
              <span>{contextOpen ? "关闭上下文" : "当前上下文"}</span>
            </button>
          ) : null}
          <span className="composer-hint">Shift + Enter 换行</span>
        </div>
        <button
          type="submit"
          className="primary-action"
          aria-label="发送"
          disabled={!draft.trim() || send.isPending || newConversationModelRequiresConfiguration}
        >
          <PaperPlaneTilt size={17} weight="fill" />
          <span>{send.isPending ? "发送中…" : "发送"}</span>
          <kbd>↵</kbd>
        </button>
      </div>
      <div className="composer-feedback" aria-live="polite">
        {attachmentNotice && !chooseFiles.error ? (
          <p className="inline-success">{attachmentNotice}</p>
        ) : null}
        {send.error ? (
          <p className="inline-error">
            {userFacingError(send.error, "消息暂时未能发送，请重试。")}
          </p>
        ) : null}
        {permissionMode.error || selectPermissionMode.error ? (
          <p className="inline-error">
            {userFacingError(
              permissionMode.error ?? selectPermissionMode.error,
              "权限模式暂时无法更新，请重试。",
            )}
          </p>
        ) : null}
        {newConversationModelRequiresConfiguration ? (
          <p className="inline-error">
            使用前需要配置 OpenAI-compatible API。请前往
            <NavLink to="/settings/account?section=model">设置 → 模型</NavLink>。
          </p>
        ) : null}
        {chooseFiles.error ? (
          <p className="inline-error">
            {userFacingError(chooseFiles.error, "暂时无法添加文件，请重新选择。")}
          </p>
        ) : null}
        {selectConversationModel.error || selectConversationThinking.error ? (
          <p className="inline-error">
            {userFacingError(
              selectConversationModel.error ?? selectConversationThinking.error,
              "当前对话设置暂时没有更新，请重试。",
            )}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function NewChat({
  defaultModelRef,
  projectId,
  projectName,
}: {
  defaultModelRef: string;
  projectId?: string;
  projectName?: string;
}): React.JSX.Element {
  const models = useQuery({
    queryKey: ["models", "catalog"],
    queryFn: () => window.openerx.listModels(),
    retry: false,
  });
  const defaultModel =
    models.data?.find(
      ({ modelRef, status }) => modelRef === defaultModelRef && status === "available",
    ) ??
    models.data?.find(({ modelRef }) => modelRef === automaticModelRef) ??
    models.data?.find(({ status }) => status === "available") ??
    models.data?.[0];
  const suggestionThinkingLevel = defaultModel
    ? preferredThinkingLevel(modelThinkingLevels(defaultModel))
    : defaultThinkingLevel;
  const modelRequiresConfiguration = defaultModel?.status === "unavailable";
  return (
    <main className="new-chat-page">
      <header className="new-chat-topbar">
        <span className="topbar-product">{projectName ? `${projectName} · 新任务` : "新任务"}</span>
        <span className="topbar-state">
          {defaultModel?.status === "unavailable"
            ? "需要配置 API"
            : (defaultModel?.displayName ??
              (models.isPending ? "正在读取模型配置" : "需要配置 API"))}
        </span>
      </header>
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">{projectName ? `项目 · ${projectName}` : "个人 AI 工作区"}</p>
        <h1 id="welcome-title">{projectName ? "在这个项目中做什么？" : "今天想完成什么？"}</h1>
        <p>
          {projectName
            ? "新对话会继承项目说明和当前设备已连接的目录；权限扩大或高影响操作仍需确认。"
            : "描述目标，或附上文件；已授权范围内自动执行，越出范围或产生高影响副作用时再确认。"}
        </p>
      </section>
      {modelRequiresConfiguration ? (
        <section className="settings-card" aria-label="配置模型 API">
          <h2>先配置模型 API</h2>
          <p>
            此安装包默认使用 BYOK，不依赖 {desktopBrand.productName} 服务器。配置 API Key
            后即可开始任务。
          </p>
          <NavLink className="primary-link" to="/settings/account?section=model">
            前往设置 → 模型
          </NavLink>
        </section>
      ) : (
        <section className="suggestion-grid" aria-label="常用任务建议">
          {suggestions.map((suggestion) => (
            <Suggestion
              key={suggestion}
              text={suggestion}
              thinkingLevel={suggestionThinkingLevel}
              modelRef={defaultModel?.modelRef ?? defaultModelRef}
              projectId={projectId}
            />
          ))}
        </section>
      )}
      <Composer defaultModelRef={defaultModelRef} projectId={projectId} />
    </main>
  );
}

function Suggestion({
  text,
  thinkingLevel,
  modelRef,
  projectId,
}: {
  text: string;
  thinkingLevel: ThinkingLevel;
  modelRef: string;
  projectId?: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const send = useMutation({
    mutationFn: () =>
      withUiTimeout(
        window.openerx.sendMessage({
          conversationId: null,
          ...(projectId ? { projectId } : {}),
          text,
          modelRef,
          thinkingLevel,
          idempotencyKey: idempotencyKey("suggestion"),
        }),
        sendReceiptTimeoutMs,
      ),
    onSuccess: (receipt) => navigate(`/chat/${receipt.conversationId}`),
  });
  return (
    <div className="suggestion-item">
      <button
        type="button"
        className="suggestion-card"
        onClick={() => send.mutate()}
        disabled={send.isPending}
      >
        <Sparkle size={17} weight="regular" />
        {send.isPending ? "正在开始任务…" : text}
        <ArrowUp size={17} weight="regular" />
      </button>
      {send.error ? (
        <span className="suggestion-error" role="alert">
          {userFacingError(send.error, "暂时无法开始任务，请重试。")}
        </span>
      ) : null}
    </div>
  );
}

function ProjectNewChat({ defaultModelRef }: { defaultModelRef: string }): React.JSX.Element {
  const projectId = useParams<{ projectId: string }>().projectId ?? "";
  const project = useProject(projectId);
  if (project.isPending) return <Placeholder title="正在打开项目…" />;
  if (!project.data || project.data.project.archivedAt) {
    return <Navigate to={projectId ? `/projects/${projectId}` : "/chat/new"} replace />;
  }
  return (
    <NewChat
      defaultModelRef={defaultModelRef}
      projectId={projectId}
      projectName={project.data.project.name}
    />
  );
}

function ContextDock({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const [workspaceAccess, setWorkspaceAccess] = useState<WorkspaceAccessChoice>("read_write");
  const [workspaceAllowNetwork, setWorkspaceAllowNetwork] = useState(false);
  const [workspaceExpiryChoice, setWorkspaceExpiryChoice] =
    useState<WorkspaceExpiryChoice>("never");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const chooseFilesButtonRef = useRef<HTMLButtonElement>(null);
  const chooseDirectoryButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeButtonRef.current?.focus(), []);
  const conversation = useQuery({
    queryKey: chatKeys.conversation(conversationId),
    queryFn: () => window.openerx.getConversation({ conversationId }),
    enabled: Boolean(conversationId),
  });
  const contextProject = useProject(conversation.data?.conversation.projectId ?? "");
  const files = useQuery({
    queryKey: ["files", conversationId],
    queryFn: () => withUiTimeout(window.openerx.listFiles({ conversationId })),
    enabled: Boolean(conversationId),
    retry: false,
  });
  const workspaces = useQuery({
    queryKey: ["workspaces", conversationId],
    queryFn: () => withUiTimeout(window.openerx.listWorkspaces({ conversationId })),
    enabled: Boolean(conversationId),
    retry: false,
  });
  const chooseWorkspace = useMutation({
    mutationFn: () =>
      window.openerx.chooseWorkspace({
        conversationId,
        access: workspaceAccess,
        allowNetwork: workspaceAccess === "read_write" && workspaceAllowNetwork,
        expiresAt: workspaceExpiry(workspaceExpiryChoice),
      }),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setContextNotice(
        workspace
          ? `已授权工作区 ${workspace.displayName}；${workspace.access === "read_write" ? "读写" : "只读"}、网络${workspace.allowNetwork ? "允许" : "禁止"}、${workspaceExpiryLabel(workspace.expiresAt)}。`
          : "已取消工作区选择。",
      );
    },
  });
  const revokeWorkspace = useMutation({
    mutationFn: (workspaceGrantId: string) => window.openerx.revokeWorkspace({ workspaceGrantId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setContextNotice("已撤销工作区；后续 Turn 不再暴露其工具或项目指令。");
    },
  });
  const chooseFiles = useMutation({
    mutationFn: () => window.openerx.chooseFiles({ conversationId }),
    onSuccess: async (selectedFiles) => {
      await queryClient.invalidateQueries({ queryKey: ["files"] });
      setContextNotice(
        selectedFiles.length > 0
          ? `已把 ${selectedFiles.length} 个文件加入当前对话。`
          : "已取消文件选择。",
      );
    },
    onSettled: () => window.requestAnimationFrame(() => chooseFilesButtonRef.current?.focus()),
  });
  const chooseDirectory = useMutation({
    mutationFn: () => window.openerx.chooseDirectory({ conversationId }),
    onSuccess: async (selectedFiles) => {
      await queryClient.invalidateQueries({ queryKey: ["files"] });
      setContextNotice(
        selectedFiles.length > 0
          ? `已从所选文件夹加入 ${selectedFiles.length} 个文件。`
          : "已取消文件夹选择。",
      );
    },
    onSettled: () => window.requestAnimationFrame(() => chooseDirectoryButtonRef.current?.focus()),
  });
  const revoke = useMutation({
    mutationFn: (scopeId: string) => window.openerx.revokeFileScope({ scopeId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["files"] });
      setContextNotice("已撤销原始路径权限；受控副本仍保留在当前对话中。");
    },
  });
  const fileList = files.data ?? [];

  return (
    <aside
      className="context-dock"
      role="dialog"
      aria-modal="true"
      aria-label="当前上下文"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        trapFocus(event);
      }}
    >
      <header className="context-dock-header">
        <div>
          <div className="context-title-row">
            <h2>当前上下文</h2>
            <Info size={15} weight="regular" />
          </div>
          <p>
            {conversation.data?.conversation.projectId
              ? "包含项目继承与仅此对话内容"
              : "仅用于当前对话"}
          </p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="icon-button"
          aria-label="关闭上下文"
          onClick={onClose}
        >
          <X size={19} weight="regular" />
        </button>
      </header>

      {conversation.data?.conversation.projectId ? (
        <section className="context-project-source" aria-label="项目上下文来源">
          <span className="context-project-source-label">来自项目</span>
          <NavLink to={`/projects/${conversation.data.conversation.projectId}`}>
            {contextProject.data?.project.name ?? "正在读取项目…"}
          </NavLink>
          <p className="context-project-source-instructions">
            {contextProject.data?.project.instructions ||
              "此项目没有说明；已连接目录仍会在下一轮自动继承。"}
          </p>
        </section>
      ) : null}

      <section className="context-files" aria-labelledby="context-files-title">
        <div className="context-section-heading">
          <h3 id="context-files-title">文件</h3>
          <span>{fileList.length}</span>
        </div>
        <div className="context-dropzone">
          <FileText size={26} weight="regular" />
          <strong>添加文件或受控文件夹</strong>
          <span>支持 PDF、Office、表格、图片、文本、代码与 HTML（单个 ≤50MB）</span>
          <span>选择文件夹只授权读取所选目录；原始路径权限可随时撤销。</span>
          <div className="context-picker-actions">
            <button
              ref={chooseFilesButtonRef}
              type="button"
              onClick={() => chooseFiles.mutate()}
              disabled={chooseFiles.isPending}
            >
              {chooseFiles.isPending ? "正在选择…" : "选择文件"}
            </button>
            <button
              ref={chooseDirectoryButtonRef}
              type="button"
              onClick={() => chooseDirectory.mutate()}
              disabled={chooseDirectory.isPending}
            >
              {chooseDirectory.isPending ? "正在选择…" : "选择文件夹"}
            </button>
          </div>
        </div>
        {contextNotice && !chooseFiles.error && !chooseDirectory.error && !revoke.error ? (
          <p className="inline-success" role="status">
            {contextNotice}
          </p>
        ) : null}
        {chooseFiles.error || chooseDirectory.error ? (
          <div className="context-inline-state" role="alert">
            <p className="inline-error">
              {userFacingError(
                chooseFiles.error ?? chooseDirectory.error,
                "无法完成选择，请关闭面板后重新打开再试。",
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                chooseFiles.reset();
                chooseDirectory.reset();
              }}
            >
              清除提示
            </button>
          </div>
        ) : null}
        <div className="context-file-list">
          {fileList.map((file) => {
            const sourceScopeId = file.sourceScopeId;
            return (
              <article className="context-file" key={file.id}>
                <div className="context-file-icon">
                  <FileText size={19} weight="regular" />
                </div>
                <div className="context-file-copy">
                  <strong title={file.displayName}>{file.displayName}</strong>
                  <span>
                    {formatBytes(file.sizeBytes)} · {file.format.toUpperCase()}
                  </span>
                </div>
                <span
                  className={`context-file-status status-${file.parseStatus === "ready" ? "ready" : "pending"}`}
                >
                  {file.parseStatus === "ready"
                    ? "已解析"
                    : file.parseStatus === "failed"
                      ? file.parseErrorCode
                      : "待解析"}
                </span>
                {sourceScopeId ? (
                  <button
                    type="button"
                    className="icon-button context-file-menu"
                    aria-label={`撤销 ${file.displayName} 的源文件权限`}
                    title="撤销源文件权限（受控副本仍保留）"
                    onClick={() => revoke.mutate(sourceScopeId)}
                  >
                    <X size={16} weight="bold" />
                  </button>
                ) : (
                  <span className="context-file-cloud-copy">云端副本</span>
                )}
              </article>
            );
          })}
          {files.isPending ? <p className="muted-copy">正在读取文件…</p> : null}
          {files.error ? (
            <div className="context-inline-state">
              <p className="inline-error">
                {userFacingError(files.error, "暂时无法读取当前对话的文件。")}
              </p>
              <button type="button" onClick={() => void files.refetch()}>
                重试
              </button>
            </div>
          ) : null}
          {!files.isPending && !files.error && fileList.length === 0 ? (
            <p className="muted-copy">还没有添加文件。上方选择的内容只会用于当前对话。</p>
          ) : null}
          {revoke.error ? (
            <p className="inline-error" role="alert">
              {userFacingError(revoke.error, "暂时无法撤销原始路径权限，请重试。")}
            </p>
          ) : null}
        </div>
      </section>

      <section className="context-files" aria-labelledby="context-workspaces-title">
        <div className="context-section-heading">
          <h3 id="context-workspaces-title">工作区目录</h3>
          <span>{workspaces.data?.length ?? 0}</span>
        </div>
        <div className="context-dropzone">
          <FolderSimple size={26} weight="regular" />
          <strong>添加仅用于当前对话的目录</strong>
          <span>项目目录在上方标记为“来自项目”；这里新增的授权不会反向修改项目配置。</span>
          <div className="workspace-grant-controls">
            <label>
              <span>访问权限</span>
              <select
                value={workspaceAccess}
                onChange={(event) => {
                  const access = event.target.value as WorkspaceAccessChoice;
                  setWorkspaceAccess(access);
                  if (access === "read_only") setWorkspaceAllowNetwork(false);
                }}
              >
                <option value="read_write">读写</option>
                <option value="read_only">只读</option>
              </select>
            </label>
            <label>
              <span>有效期</span>
              <select
                value={workspaceExpiryChoice}
                onChange={(event) =>
                  setWorkspaceExpiryChoice(event.target.value as WorkspaceExpiryChoice)
                }
              >
                <option value="never">长期有效</option>
                <option value="1h">1 小时</option>
                <option value="24h">24 小时</option>
                <option value="7d">7 天</option>
              </select>
            </label>
            <label className="workspace-network-choice">
              <input
                type="checkbox"
                checked={workspaceAllowNetwork}
                disabled={workspaceAccess === "read_only"}
                onChange={(event) => setWorkspaceAllowNetwork(event.target.checked)}
              />
              <span>允许 Shell 网络</span>
            </label>
          </div>
          <div className="context-picker-actions">
            <button
              type="button"
              onClick={() => chooseWorkspace.mutate()}
              disabled={chooseWorkspace.isPending}
            >
              {chooseWorkspace.isPending ? "正在选择…" : "授权工作区"}
            </button>
          </div>
        </div>
        <div className="context-file-list">
          {workspaces.data?.map((workspace) => {
            const sourceLabel =
              workspace.bindingSource === "project"
                ? "来自项目"
                : workspace.bindingSource === "default"
                  ? "默认工作区"
                  : "仅此对话";
            const roleLabel =
              workspace.bindingRole === "primary"
                ? "主目录"
                : workspace.bindingRole === "additional"
                  ? "附加目录"
                  : "目录";
            return (
              <article className="context-file" key={workspace.id}>
                <div className="context-file-icon">
                  <FolderSimple size={19} weight="regular" />
                </div>
                <div className="context-file-copy">
                  <strong title={workspace.rootPath}>{workspace.displayName}</strong>
                  <span>
                    {sourceLabel} · {roleLabel} ·{" "}
                    {workspace.access === "read_write" ? "读写" : "只读"} · 网络
                    {workspace.allowNetwork ? "允许" : "禁止"} ·{" "}
                    {workspaceExpiryLabel(workspace.expiresAt)} · {workspace.rootPath}
                  </span>
                </div>
                {workspace.bindingSource === "default" ? (
                  <span className="context-file-cloud-copy">自动管理</span>
                ) : workspace.bindingSource === "project" ? (
                  <span className="context-file-cloud-copy">来自项目</span>
                ) : (
                  <button
                    type="button"
                    className="icon-button context-file-menu"
                    aria-label={`撤销 ${workspace.displayName} 工作区`}
                    onClick={() => revokeWorkspace.mutate(workspace.id)}
                  >
                    <X size={16} weight="bold" />
                  </button>
                )}
              </article>
            );
          })}
          {workspaces.isPending ? <p className="muted-copy">正在读取工作区…</p> : null}
          {!workspaces.isPending && (workspaces.data?.length ?? 0) === 0 ? (
            <p className="muted-copy">尚未授权项目目录。</p>
          ) : null}
          {workspaces.error || chooseWorkspace.error || revokeWorkspace.error ? (
            <p className="inline-error" role="alert">
              {userFacingError(
                workspaces.error ?? chooseWorkspace.error ?? revokeWorkspace.error,
                "暂时无法更新工作区授权，请重试。",
              )}
            </p>
          ) : null}
        </div>
      </section>

      <footer className="context-dock-footer">
        <span>
          <CheckCircle size={16} weight="fill" /> 模型数据处理以服务商政策为准
        </span>
        <button
          type="button"
          className="text-button"
          aria-expanded={privacyOpen}
          onClick={() => setPrivacyOpen((open) => !open)}
        >
          {privacyOpen ? "收起说明" : "了解数据边界"}
        </button>
        {privacyOpen ? (
          <p className="privacy-details">
            当前任务的相关内容可能发送至所选模型服务，保存和训练用途以服务商政策及账户设置为准。
            文件会生成受控副本供当前任务使用；原始路径权限可以随时撤销。凭证、终端内容和本地路径不会进入诊断导出。
          </p>
        ) : null}
      </footer>
    </aside>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

const libraryConversationPageSize = 6;

function libraryTextMatches(query: string, values: Array<string | null | undefined>): boolean {
  return values.some((value) => value?.toLocaleLowerCase("zh-CN").includes(query));
}

function ContentPreviewRenderer({
  preview,
  previewMode,
  ariaLabel,
}: {
  preview: ContentPreview;
  previewMode: "preview" | "source";
  ariaLabel: string;
}): React.JSX.Element {
  if (preview.renderedSurfaces.length > 0 && previewMode === "preview") {
    return (
      <section className="office-preview-surfaces" aria-label={ariaLabel}>
        {preview.renderedSurfaces.map((surface) => (
          <figure key={`${surface.kind}-${surface.index}`}>
            <figcaption>{surface.label}</figcaption>
            <img src={surface.imageDataUrl} alt={`${preview.displayName} ${surface.label}`} />
          </figure>
        ))}
      </section>
    );
  }

  if (preview.imageDataUrl && previewMode === "preview") {
    return (
      <img
        className="standalone-image-preview"
        src={preview.imageDataUrl}
        alt={preview.displayName}
      />
    );
  }

  if (preview.format === "html" && previewMode === "preview" && preview.source) {
    return (
      <iframe
        title="HTML 隔离预览"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={preview.source}
      />
    );
  }

  if (preview.format === "markdown" && previewMode === "preview") {
    return (
      <article className="markdown-body artifact-markdown-preview">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.parsedText}</ReactMarkdown>
      </article>
    );
  }

  return <pre>{previewMode === "source" ? preview.source : preview.parsedText}</pre>;
}

function FilesAndArtifacts(): React.JSX.Element {
  const [selected, setSelected] = useState<{
    kind: "personal_file" | "artifact";
    id: string;
  } | null>(null);
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryPage, setLibraryPage] = useState(1);
  const files = useQuery({ queryKey: ["files", "all"], queryFn: () => window.openerx.listFiles() });
  const artifacts = useQuery({
    queryKey: ["artifacts"],
    queryFn: () => window.openerx.listArtifacts(),
  });
  const conversations = useQuery({
    queryKey: chatKeys.list(true),
    queryFn: () => window.openerx.listConversations({ includeArchived: true }),
  });
  const conversationSignature =
    conversations.data?.map(({ id, revision }) => `${id}:${revision}`).join("|") ?? "pending";
  const conversationLibrary = useQuery({
    queryKey: ["library", "by-conversation", conversationSignature],
    enabled: conversations.data !== undefined,
    queryFn: async () => {
      const groups = await Promise.all(
        (conversations.data ?? []).map(async (conversation) => {
          const [conversationFiles, conversationArtifacts] = await Promise.all([
            window.openerx.listFiles({ conversationId: conversation.id }),
            window.openerx.listArtifacts({ conversationId: conversation.id }),
          ]);
          return {
            conversation,
            files: conversationFiles,
            artifacts: conversationArtifacts,
          };
        }),
      );
      return groups.filter(
        ({ files: groupFiles, artifacts: groupArtifacts }) =>
          groupFiles.length > 0 || groupArtifacts.length > 0,
      );
    },
  });
  const linkedFileIds = useMemo(
    () =>
      new Set(
        (conversationLibrary.data ?? []).flatMap(({ files: groupFiles }) =>
          groupFiles.map(({ id }) => id),
        ),
      ),
    [conversationLibrary.data],
  );
  const linkedArtifactIds = useMemo(
    () =>
      new Set(
        (conversationLibrary.data ?? []).flatMap(({ artifacts: groupArtifacts }) =>
          groupArtifacts.map(({ id }) => id),
        ),
      ),
    [conversationLibrary.data],
  );
  const unlinkedFiles = (files.data ?? []).filter(({ id }) => !linkedFileIds.has(id));
  const unlinkedArtifacts = (artifacts.data ?? []).filter(({ id }) => !linkedArtifactIds.has(id));
  const totalItemCount = (files.data?.length ?? 0) + (artifacts.data?.length ?? 0);
  const normalizedLibrarySearch = librarySearch.trim().toLocaleLowerCase("zh-CN");
  const filteredConversationLibrary = useMemo(
    () =>
      (conversationLibrary.data ?? []).flatMap((group) => {
        if (!normalizedLibrarySearch) return [group];
        const conversationMatches = libraryTextMatches(normalizedLibrarySearch, [
          group.conversation.title,
          group.conversation.lastMessagePreview,
        ]);
        const groupFiles = conversationMatches
          ? group.files
          : group.files.filter((file) =>
              libraryTextMatches(normalizedLibrarySearch, [
                file.displayName,
                file.format,
                file.sourceRelativePath,
              ]),
            );
        const groupArtifacts = conversationMatches
          ? group.artifacts
          : group.artifacts.filter((artifact) =>
              libraryTextMatches(normalizedLibrarySearch, [
                artifact.displayName,
                artifact.format,
                artifact.mediaType,
              ]),
            );
        return groupFiles.length > 0 || groupArtifacts.length > 0
          ? [{ ...group, files: groupFiles, artifacts: groupArtifacts }]
          : [];
      }),
    [conversationLibrary.data, normalizedLibrarySearch],
  );
  const filteredUnlinkedFiles = useMemo(
    () =>
      normalizedLibrarySearch
        ? unlinkedFiles.filter((file) =>
            libraryTextMatches(normalizedLibrarySearch, [
              file.displayName,
              file.format,
              file.sourceRelativePath,
            ]),
          )
        : unlinkedFiles,
    [normalizedLibrarySearch, unlinkedFiles],
  );
  const filteredUnlinkedArtifacts = useMemo(
    () =>
      normalizedLibrarySearch
        ? unlinkedArtifacts.filter((artifact) =>
            libraryTextMatches(normalizedLibrarySearch, [
              artifact.displayName,
              artifact.format,
              artifact.mediaType,
            ]),
          )
        : unlinkedArtifacts,
    [normalizedLibrarySearch, unlinkedArtifacts],
  );
  const libraryPageCount = Math.max(
    1,
    Math.ceil(filteredConversationLibrary.length / libraryConversationPageSize),
  );
  const visibleLibraryPage = Math.min(libraryPage, libraryPageCount);
  const pagedConversationLibrary = filteredConversationLibrary.slice(
    (visibleLibraryPage - 1) * libraryConversationPageSize,
    visibleLibraryPage * libraryConversationPageSize,
  );
  const filteredLibraryItemCount =
    filteredConversationLibrary.reduce(
      (count, group) => count + group.files.length + group.artifacts.length,
      0,
    ) +
    filteredUnlinkedFiles.length +
    filteredUnlinkedArtifacts.length;
  useEffect(() => {
    if (libraryPage > libraryPageCount) setLibraryPage(libraryPageCount);
  }, [libraryPage, libraryPageCount]);
  const chooseFiles = useMutation({
    mutationFn: () => window.openerx.chooseFiles(),
    onSuccess: async (selectedFiles) => {
      await files.refetch();
      setFileNotice(
        selectedFiles.length > 0 ? `已添加 ${selectedFiles.length} 个文件。` : "已取消文件选择。",
      );
    },
  });
  const chooseDirectory = useMutation({
    mutationFn: () => window.openerx.chooseDirectory(),
    onSuccess: async (selectedFiles) => {
      await files.refetch();
      setFileNotice(
        selectedFiles.length > 0
          ? `已从所选文件夹添加 ${selectedFiles.length} 个文件。`
          : "已取消文件夹选择。",
      );
    },
  });
  const preview = useQuery({
    queryKey: ["content-preview", selected?.kind, selected?.id],
    queryFn: () => {
      if (!selected) throw new Error("No preview selected");
      return selected.kind === "personal_file"
        ? window.openerx.previewFile({ personalFileId: selected.id })
        : window.openerx.previewArtifact({ artifactId: selected.id });
    },
    enabled: selected !== null,
    retry: false,
  });
  const saveArtifact = useMutation({
    mutationFn: async (artifactId: string) => await window.openerx.saveArtifact({ artifactId }),
  });
  return (
    <main className={`library-page ${selected ? "preview-is-open" : ""}`}>
      <div className="library-browser-pane">
        <header className="library-header">
          <div>
            <p className="eyebrow">本地优先 · 可同步对象</p>
            <h1>个人文件与成果</h1>
            <p>按对话集中查看附件与生成成果；成果按版本保留，不静默覆盖。</p>
          </div>
          <div className="library-header-actions">
            <button
              type="button"
              onClick={() => chooseDirectory.mutate()}
              disabled={chooseDirectory.isPending}
              title="仅授权读取你选择的目录；之后可撤销原始路径权限"
            >
              <FolderSimple size={17} />
              {chooseDirectory.isPending ? "正在选择…" : "添加文件夹"}
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={() => chooseFiles.mutate()}
              disabled={chooseFiles.isPending}
            >
              <Plus size={17} /> {chooseFiles.isPending ? "正在选择…" : "添加文件"}
            </button>
          </div>
        </header>
        <p className="library-scope-note">
          同一文件用于多个对话时会分别显示；直接从本页添加的内容会先归入“未关联对话”。
        </p>
        <div className="library-toolbar">
          <label className="library-search" htmlFor="library-search-input">
            <MagnifyingGlass size={18} aria-hidden="true" />
            <input
              id="library-search-input"
              type="search"
              aria-label="搜索文件、成果或对话"
              value={librarySearch}
              placeholder="搜索文件、成果或对话"
              onChange={(event) => {
                setLibrarySearch(event.target.value);
                setLibraryPage(1);
              }}
            />
            {librarySearch ? (
              <button
                type="button"
                aria-label="清除资料库搜索"
                onClick={() => {
                  setLibrarySearch("");
                  setLibraryPage(1);
                }}
              >
                <X size={15} />
              </button>
            ) : null}
          </label>
          <span aria-live="polite">
            {normalizedLibrarySearch ? "找到" : "共"} {filteredConversationLibrary.length} 个对话 ·{" "}
            {filteredLibraryItemCount} 项
          </span>
        </div>
        <div className="library-feedback" aria-live="polite">
          {fileNotice && !chooseFiles.error && !chooseDirectory.error ? (
            <p className="inline-success">{fileNotice}</p>
          ) : null}
          {files.error ||
          artifacts.error ||
          conversations.error ||
          conversationLibrary.error ||
          chooseFiles.error ||
          chooseDirectory.error ? (
            <p className="inline-error">
              {userFacingError(
                files.error ??
                  artifacts.error ??
                  conversations.error ??
                  conversationLibrary.error ??
                  chooseFiles.error ??
                  chooseDirectory.error,
                "暂时无法读取或添加文件，请重试。",
              )}
            </p>
          ) : null}
        </div>
        <section className="library-section" aria-labelledby="conversation-files-title">
          <div className="library-section-title">
            <h2 id="conversation-files-title">按对话</h2>
            <span>
              {normalizedLibrarySearch
                ? `${filteredConversationLibrary.length} 个匹配对话`
                : `${conversationLibrary.data?.length ?? 0} 个对话`}
            </span>
          </div>
          <div className="conversation-library-list">
            {pagedConversationLibrary.map(
              ({ conversation, files: groupFiles, artifacts: groupArtifacts }) => (
                <article
                  className="conversation-library-group"
                  key={conversation.id}
                  aria-labelledby={`library-conversation-${conversation.id}`}
                >
                  <header>
                    <div className="conversation-library-title">
                      <ChatCircle size={19} />
                      <div>
                        <NavLink
                          id={`library-conversation-${conversation.id}`}
                          to={`/chat/${conversation.id}`}
                        >
                          {conversation.title}
                        </NavLink>
                        <span>
                          {conversation.archivedAt ? "已归档 · " : ""}
                          更新于 {formatUpdatedAt(conversation.updatedAt)}
                        </span>
                      </div>
                    </div>
                    <span className="conversation-library-count">
                      {groupFiles.length} 个文件 · {groupArtifacts.length} 个成果
                    </span>
                  </header>
                  <div className="library-item-list">
                    {groupFiles.map((file: PersonalFile) => (
                      <button
                        type="button"
                        className={`library-card ${
                          selected?.kind === "personal_file" && selected.id === file.id
                            ? "is-selected"
                            : ""
                        }`}
                        aria-pressed={selected?.kind === "personal_file" && selected.id === file.id}
                        key={`file-${file.id}`}
                        onClick={() => {
                          setSelected({ kind: "personal_file", id: file.id });
                          setPreviewMode("preview");
                        }}
                      >
                        <FileText size={24} />
                        <strong>{file.displayName}</strong>
                        <span>
                          文件 · {file.format.toUpperCase()} · {formatBytes(file.sizeBytes)}
                        </span>
                        <span>
                          {file.parseStatus === "ready"
                            ? "引用已就绪"
                            : (file.parseErrorCode ?? "解析中")}
                        </span>
                      </button>
                    ))}
                    {groupArtifacts.map((artifact) => (
                      <button
                        type="button"
                        className={`library-card ${
                          selected?.kind === "artifact" && selected.id === artifact.id
                            ? "is-selected"
                            : ""
                        }`}
                        aria-pressed={selected?.kind === "artifact" && selected.id === artifact.id}
                        key={`artifact-${artifact.id}`}
                        onClick={() => {
                          setSelected({ kind: "artifact", id: artifact.id });
                          setPreviewMode("preview");
                        }}
                      >
                        <FolderSimple size={24} />
                        <strong>{artifact.displayName}</strong>
                        <span>
                          成果 · {artifact.format.toUpperCase()} · v{artifact.currentVersion}
                        </span>
                        <span>{artifact.versions.length} 个不可变版本</span>
                      </button>
                    ))}
                  </div>
                </article>
              ),
            )}
          </div>
        </section>
        {libraryPageCount > 1 ? (
          <nav className="library-pagination" aria-label="文件列表分页">
            <button
              type="button"
              disabled={visibleLibraryPage === 1}
              onClick={() => setLibraryPage((page) => Math.max(1, page - 1))}
            >
              <ArrowLeft size={15} /> 上一页
            </button>
            <span>
              第 {visibleLibraryPage} / {libraryPageCount} 页
            </span>
            <button
              type="button"
              disabled={visibleLibraryPage === libraryPageCount}
              onClick={() => setLibraryPage((page) => Math.min(libraryPageCount, page + 1))}
            >
              下一页 <ArrowRight size={15} />
            </button>
          </nav>
        ) : null}
        {conversationLibrary.isPending ? <p className="muted-copy">正在整理对话文件…</p> : null}
        {!conversationLibrary.isPending &&
        filteredUnlinkedFiles.length + filteredUnlinkedArtifacts.length > 0 ? (
          <section className="library-section" aria-labelledby="unlinked-files-title">
            <div className="library-section-title">
              <h2 id="unlinked-files-title">未关联对话</h2>
              <span>{filteredUnlinkedFiles.length + filteredUnlinkedArtifacts.length} 项</span>
            </div>
            <article className="conversation-library-group conversation-library-unlinked">
              <header>
                <div className="conversation-library-title">
                  <FolderSimple size={19} />
                  <div>
                    <strong>资料库直接添加</strong>
                    <span>在对话中使用后，会同时显示到对应对话下</span>
                  </div>
                </div>
              </header>
              <div className="library-item-list">
                {filteredUnlinkedFiles.map((file) => (
                  <button
                    type="button"
                    className={`library-card ${
                      selected?.kind === "personal_file" && selected.id === file.id
                        ? "is-selected"
                        : ""
                    }`}
                    aria-pressed={selected?.kind === "personal_file" && selected.id === file.id}
                    key={`unlinked-file-${file.id}`}
                    onClick={() => {
                      setSelected({ kind: "personal_file", id: file.id });
                      setPreviewMode("preview");
                    }}
                  >
                    <FileText size={24} />
                    <strong>{file.displayName}</strong>
                    <span>
                      文件 · {file.format.toUpperCase()} · {formatBytes(file.sizeBytes)}
                    </span>
                    <span>
                      {file.parseStatus === "ready"
                        ? "引用已就绪"
                        : (file.parseErrorCode ?? "解析中")}
                    </span>
                  </button>
                ))}
                {filteredUnlinkedArtifacts.map((artifact) => (
                  <button
                    type="button"
                    className={`library-card ${
                      selected?.kind === "artifact" && selected.id === artifact.id
                        ? "is-selected"
                        : ""
                    }`}
                    aria-pressed={selected?.kind === "artifact" && selected.id === artifact.id}
                    key={`unlinked-artifact-${artifact.id}`}
                    onClick={() => {
                      setSelected({ kind: "artifact", id: artifact.id });
                      setPreviewMode("preview");
                    }}
                  >
                    <FolderSimple size={24} />
                    <strong>{artifact.displayName}</strong>
                    <span>
                      成果 · {artifact.format.toUpperCase()} · v{artifact.currentVersion}
                    </span>
                    <span>{artifact.versions.length} 个不可变版本</span>
                  </button>
                ))}
              </div>
            </article>
          </section>
        ) : null}
        {!conversationLibrary.isPending &&
        normalizedLibrarySearch &&
        filteredConversationLibrary.length === 0 &&
        filteredUnlinkedFiles.length === 0 &&
        filteredUnlinkedArtifacts.length === 0 ? (
          <div className="empty-state empty-state-compact empty-state-without-action">
            <MagnifyingGlass size={25} />
            <div>
              <strong>没有匹配内容</strong>
              <p>请尝试文件名、成果格式或对话标题中的其他关键词。</p>
            </div>
          </div>
        ) : null}
        {!files.isPending &&
        !artifacts.isPending &&
        !conversationLibrary.isPending &&
        totalItemCount === 0 ? (
          <div className="empty-state empty-state-compact">
            <FolderSimple size={25} />
            <div>
              <strong>还没有文件或成果</strong>
              <p>添加文件，或在对话中生成报告、表格和其他成果后，就可以按对话查找。</p>
            </div>
            <NavLink to="/chat/new">开始一个新任务</NavLink>
          </div>
        ) : null}
      </div>
      {selected ? (
        <section className="content-preview" aria-labelledby="content-preview-title">
          <header>
            <div>
              <p className="eyebrow">受控内容预览</p>
              <h2 id="content-preview-title">{preview.data?.displayName ?? "正在加载…"}</h2>
            </div>
            <div className="preview-actions">
              {selected.kind === "artifact" ? (
                <button
                  type="button"
                  disabled={saveArtifact.isPending}
                  onClick={() => saveArtifact.mutate(selected.id)}
                >
                  <DownloadSimple size={15} />
                  {saveArtifact.isPending ? "保存中…" : "下载 / 另存"}
                </button>
              ) : null}
              {preview.data && preview.data.source !== null ? (
                <>
                  <button
                    type="button"
                    className={previewMode === "preview" ? "is-active" : ""}
                    onClick={() => setPreviewMode("preview")}
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    className={previewMode === "source" ? "is-active" : ""}
                    onClick={() => setPreviewMode("source")}
                  >
                    源码
                  </button>
                </>
              ) : null}
              <button type="button" onClick={() => setSelected(null)}>
                关闭
              </button>
            </div>
          </header>
          {preview.error ? <p className="inline-error">{preview.error.message}</p> : null}
          {saveArtifact.error ? <p className="inline-error">{saveArtifact.error.message}</p> : null}
          {saveArtifact.data ? (
            <p className="inline-success">已保存 {saveArtifact.data.fileName}</p>
          ) : null}
          <div className="content-preview-body">
            {preview.data ? (
              <ContentPreviewRenderer
                preview={preview.data}
                previewMode={previewMode}
                ariaLabel="成果视觉预览"
              />
            ) : (
              <p className="muted-copy">正在准备预览…</p>
            )}
          </div>
          {preview.data?.citations.length ? (
            <footer>{preview.data.citations.length} 个稳定引用位置</footer>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function MessageCard({
  message,
  attachments,
  filesById,
  activities = [],
  onOpenBrowserPreview,
}: {
  message: Message;
  attachments: Attachment[];
  filesById: ReadonlyMap<string, PersonalFile>;
  activities?: WorkItem[];
  onOpenBrowserPreview?: (preview: BrowserCallPreview) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.parts[0]?.text ?? "");
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"positive" | "negative" | null>(null);
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [selectedActivityRunIds, setSelectedActivityRunIds] = useState<
    Record<string, string | null>
  >({});
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationId = message.conversationId;
  useEffect(() => {
    if (editing) window.requestAnimationFrame(() => editTextareaRef.current?.focus());
  }, [editing]);
  const copyText = async (value: string, successMessage: string): Promise<void> => {
    try {
      if (!navigator.clipboard) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(value);
      setActionNotice(successMessage);
    } catch {
      setActionNotice("无法访问剪贴板，请手动选择并复制内容。");
    }
  };
  const stop = useMutation({
    mutationFn: () =>
      window.openerx.stopGeneration({ conversationId, assistantMessageId: message.id }),
  });
  const regenerate = useMutation({
    mutationFn: () =>
      window.openerx.regenerateMessage({
        conversationId,
        assistantMessageId: message.id,
        idempotencyKey: idempotencyKey("regenerate"),
      }),
    onSuccess: async () => {
      setActionNotice("已在新分支中重新生成，原回复仍保留。");
      await queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) });
    },
  });
  const edit = useMutation({
    mutationFn: () =>
      window.openerx.editMessage({
        conversationId,
        messageId: message.id,
        text: editText,
        idempotencyKey: idempotencyKey("edit"),
      }),
    onSuccess: async () => {
      setEditing(false);
      setActionNotice("已提交修改，正在从这里重新生成回复。");
      await queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) });
    },
  });
  const text = message.parts.map((part) => part.text).join("\n\n");
  const assistantTextParts = message.parts.filter((part) => part.text.length > 0);
  const running = message.role === "assistant" && ["pending", "streaming"].includes(message.status);
  const hasSeparateConclusion =
    message.role === "assistant" &&
    activities.length > 0 &&
    !running &&
    assistantTextParts.length > 0;
  const conclusionPart = hasSeparateConclusion ? assistantTextParts.at(-1) : undefined;
  const processTextParts = hasSeparateConclusion
    ? assistantTextParts.slice(0, -1)
    : assistantTextParts;
  const assistantTimelineVisible = activities.length === 0 || activitiesOpen || running;
  const usage = useQuery({
    queryKey: ["usage", "message", message.id],
    queryFn: () => window.openerx.getUsage({ messageId: message.id }),
    enabled: message.role === "assistant" && !running,
    retry: false,
  });
  const usageRecords = useQuery({
    queryKey: ["usage", "records", "message", message.id],
    queryFn: () => window.openerx.getUsageRecords({ messageId: message.id }),
    enabled: message.role === "assistant" && !running,
    retry: false,
  });
  const execution: UsageRecord | undefined = usageRecords.data?.at(-1);
  const showMessageStatus = message.status !== "completed";
  const primaryActivity = activities[0];
  const activityElapsed = primaryActivity
    ? elapsedTime(primaryActivity.createdAt, primaryActivity.completedAt)
    : null;
  const activityRunning = activities.some((activity) => activity.status !== "completed");

  const activityAfterPart = (partIndex: number, partCount: number): ReactNode => {
    if (!activitiesOpen || !onOpenBrowserPreview) return null;
    return (
      <div className="assistant-response-part-activities">
        {activities.map((workItem) => (
          <ToolActivity
            key={`${workItem.id}:${partIndex}`}
            workItem={workItem}
            segment={{ index: partIndex, count: partCount }}
            selectedRunId={selectedActivityRunIds[workItem.id] ?? workItem.activeRunId}
            onSelectRun={(runId) =>
              setSelectedActivityRunIds((current) => ({ ...current, [workItem.id]: runId }))
            }
            onOpenBrowserPreview={onOpenBrowserPreview}
          />
        ))}
      </div>
    );
  };

  const assistantMarkdown = (value: string): ReactNode => (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <div className="code-block">
              <button
                type="button"
                onClick={(event) => {
                  const code = event.currentTarget.nextElementSibling?.textContent ?? "";
                  void copyText(code, "代码已复制到剪贴板。");
                }}
              >
                {actionNotice === "代码已复制到剪贴板。" ? "已复制" : "复制代码"}
              </button>
              <pre>{children}</pre>
            </div>
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );

  return (
    <article
      className={`message message-${message.role} ${running ? "message-is-streaming" : ""}`}
      data-message-status={message.status}
      aria-busy={running || undefined}
    >
      <div className="message-content">
        {showMessageStatus ? (
          <header className="message-state-header">
            <strong>{message.role === "user" ? "你" : desktopBrand.productName}</strong>
            <span className={`message-status status-${message.status}`}>
              {messageStatusLabel[message.status]}
            </span>
          </header>
        ) : null}
        {attachments.length > 0 ? (
          <ul className="message-attachments" aria-label="消息附件">
            {attachments.map((attachment) => {
              const file = filesById.get(attachment.personalFileId);
              return file ? (
                <AttachmentCard key={attachment.id} file={file} placement="message" />
              ) : (
                <li
                  key={attachment.id}
                  className="attachment-card attachment-card-message attachment-card-missing"
                >
                  <div className="attachment-visual" aria-hidden="true">
                    <FileText size={24} weight="regular" />
                  </div>
                  <div className="attachment-copy">
                    <strong>附件</strong>
                    <span>正在读取…</span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {editing ? (
          <form
            className="edit-message"
            onSubmit={(event) => {
              event.preventDefault();
              if (editText.trim()) edit.mutate();
            }}
          >
            <textarea
              ref={editTextareaRef}
              aria-label="编辑消息内容"
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              rows={4}
            />
            <div>
              <button type="button" onClick={() => setEditing(false)}>
                取消
              </button>
              <button
                type="submit"
                disabled={!editText.trim() || editText.trim() === text.trim() || edit.isPending}
              >
                {edit.isPending ? "正在发送…" : "发送"}
              </button>
            </div>
          </form>
        ) : message.role === "assistant" ? (
          <>
            {activities.length > 0 ? (
              <button
                type="button"
                className={`assistant-activity-overview ${activitiesOpen ? "is-open" : ""}`}
                aria-expanded={activitiesOpen}
                onClick={() => setActivitiesOpen((open) => !open)}
              >
                <span>
                  <strong>
                    {activityElapsed ? `用时 ${activityElapsed}` : primaryActivity?.title}
                  </strong>
                  {activities.length > 1 ? <small>{activities.length} 次运行</small> : null}
                  <CaretDown size={13} weight="bold" aria-hidden="true" />
                </span>
                {activityRunning ? <small>进行中</small> : null}
              </button>
            ) : null}
            {assistantTimelineVisible ? (
              <div className={`assistant-response ${running ? "response-waterfall" : ""}`}>
                {processTextParts.length > 0 ? (
                  <div
                    className="assistant-response-parts"
                    data-response-part-count={assistantTextParts.length}
                  >
                    {processTextParts.map((part, index) => (
                      <section
                        key={part.id}
                        className="assistant-response-part"
                        aria-label={
                          assistantTextParts.length > 1
                            ? `${desktopBrand.productName} 进度更新 ${index + 1}`
                            : undefined
                        }
                      >
                        {assistantMarkdown(part.text)}
                        {activityAfterPart(index, assistantTextParts.length)}
                      </section>
                    ))}
                  </div>
                ) : conclusionPart ? (
                  <div className="assistant-response-parts assistant-response-tools-only">
                    <section className="assistant-response-part">{activityAfterPart(0, 1)}</section>
                  </div>
                ) : (
                  <div className="markdown-body">
                    <p className="thinking">正在思考…</p>
                    {activityAfterPart(0, 1)}
                  </div>
                )}
                {running && text ? <span className="stream-tail" aria-hidden="true" /> : null}
              </div>
            ) : null}
            {conclusionPart ? (
              <div className="assistant-response assistant-conclusion-response">
                <section
                  className="assistant-response-part"
                  aria-label={`${desktopBrand.productName} 最终答复`}
                >
                  {assistantMarkdown(conclusionPart.text)}
                </section>
              </div>
            ) : null}
          </>
        ) : (
          <p className="user-text">{text}</p>
        )}
        {message.errorCode ? (
          <p className="inline-error" role="alert">
            {messageFailureLabel(message.errorCode)}
          </p>
        ) : null}
        {(usage.data && usage.data.records > 0) || execution ? (
          <details className="message-diagnostics">
            <summary>运行详情</summary>
            {usage.data && usage.data.records > 0 ? (
              <div className="usage-line" role="status" aria-label="消息 Token 用量">
                <span>输入 {tokenValue(usage.data.inputTokens)}</span>
                <span>缓存 {tokenValue(usage.data.cachedInputTokens)}</span>
                <span>输出 {tokenValue(usage.data.outputTokens)}</span>
                <span>推理 {tokenValue(usage.data.reasoningTokens)}</span>
                <strong>总计 {tokenValue(usage.data.totalTokens)}</strong>
              </div>
            ) : null}
            {execution ? (
              <div className="model-execution" role="status" aria-label="消息模型执行详情">
                <span>选择 {execution.selectedModelRef}</span>
                <span>实际 {execution.effectiveModelRef}</span>
                {execution.fallbackReason ? (
                  <strong>降级原因：{execution.fallbackReason}</strong>
                ) : null}
              </div>
            ) : null}
          </details>
        ) : null}
      </div>
      {!editing ? (
        <footer className="message-actions">
          {text ? (
            <button
              type="button"
              className="message-action-icon"
              aria-label="复制"
              title={actionNotice === "消息已复制到剪贴板。" ? "已复制" : "复制"}
              onClick={() => void copyText(text, "消息已复制到剪贴板。")}
            >
              <Copy size={16} weight="regular" />
            </button>
          ) : null}
          {message.role === "user" ? (
            <button
              type="button"
              className="message-action-icon"
              aria-label="编辑消息"
              title="编辑消息"
              onClick={() => {
                setEditText(text);
                setActionNotice(null);
                setEditing(true);
              }}
            >
              <PencilSimple size={16} weight="regular" />
            </button>
          ) : null}
          {running ? (
            <button type="button" onClick={() => stop.mutate()} disabled={stop.isPending}>
              停止
            </button>
          ) : null}
          {message.role === "assistant" && !running ? (
            <>
              <button
                type="button"
                className={`message-action-icon ${feedback === "positive" ? "is-selected" : ""}`}
                aria-label="有帮助"
                aria-pressed={feedback === "positive"}
                title="有帮助"
                onClick={() => {
                  setFeedback((current) => (current === "positive" ? null : "positive"));
                  setActionNotice("感谢反馈。");
                }}
              >
                <ThumbsUp size={16} weight={feedback === "positive" ? "fill" : "regular"} />
              </button>
              <button
                type="button"
                className={`message-action-icon ${feedback === "negative" ? "is-selected" : ""}`}
                aria-label="没有帮助"
                aria-pressed={feedback === "negative"}
                title="没有帮助"
                onClick={() => {
                  setFeedback((current) => (current === "negative" ? null : "negative"));
                  setActionNotice("已记录反馈。");
                }}
              >
                <ThumbsDown size={16} weight={feedback === "negative" ? "fill" : "regular"} />
              </button>
              <button
                type="button"
                className="message-action-icon"
                aria-label={message.status === "failed" ? "重试并新建分支" : "重新生成到新分支"}
                onClick={() => regenerate.mutate()}
                disabled={regenerate.isPending}
                title="会创建新分支，当前回复不会被覆盖"
              >
                <ArrowClockwise size={16} weight="regular" />
              </button>
            </>
          ) : null}
        </footer>
      ) : null}
      <div className="message-feedback" aria-live="polite">
        {actionNotice ? <p>{actionNotice}</p> : null}
        {regenerate.error || edit.error || stop.error ? (
          <p className="inline-error">
            {userFacingError(
              regenerate.error ?? edit.error ?? stop.error,
              "操作暂时没有完成，请重试。",
            )}
          </p>
        ) : null}
      </div>
    </article>
  );
}

const workItemStatusLabel: Record<WorkItem["status"], string> = {
  queued: "排队中",
  running: "运行中",
  cancelling: "正在停止",
  waiting_for_user: "等待输入",
  waiting_for_permission: "等待授权",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  cancelled: "已取消",
};

const toolCallStatusLabel: Record<ToolCall["status"], string> = {
  requested: "准备中",
  waiting_for_permission: "等待授权",
  running: "操作中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const browserActionLabel: Record<string, string> = {
  open: "打开网页",
  observe: "查看网页",
  focus: "聚焦页面元素",
  invoke: "操作页面元素",
  click: "点击页面元素",
  submit: "提交页面内容",
  setValue: "填写页面内容",
  type: "输入页面内容",
  select: "选择页面选项",
  key: "使用键盘操作",
  scroll: "滚动页面",
  drag: "拖动页面元素",
  back: "返回上一页",
  forward: "前往下一页",
  reload: "刷新页面",
  upload: "上传文件",
  download: "下载文件",
  detach: "交还浏览器控制",
  close: "关闭浏览器窗口",
};

const browserCompletedActionLabel: Record<string, string> = {
  open: "打开了网页",
  observe: "查看了网页",
  focus: "聚焦了页面元素",
  invoke: "操作了页面元素",
  click: "点击了页面元素",
  submit: "提交了页面内容",
  setValue: "填写了页面内容",
  type: "输入了页面内容",
  select: "选择了页面选项",
  key: "使用了键盘",
  scroll: "滚动了页面",
  drag: "拖动了页面元素",
  back: "返回了上一页",
  forward: "前往了下一页",
  reload: "刷新了页面",
  upload: "上传了文件",
  download: "下载了文件",
  detach: "交还了浏览器控制",
  close: "关闭了浏览器窗口",
};

type BrowserResultImage = Extract<ToolCall["resultContent"][number], { type: "image" }>;

interface BrowserCallPreview {
  callId: string;
  action: string;
  actionLabel: string;
  applicationLabel: string;
  image: BrowserResultImage | null;
  input: ToolCall["input"];
  rawText: string;
  resultSummary: string | null;
  sessionId: string | null;
  state: string | null;
  status: ToolCall["status"];
  title: string | null;
  url: string | null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function browserResultPayload(call: ToolCall): Record<string, unknown> | null {
  for (const part of call.resultContent) {
    if (part.type !== "text") continue;
    const jsonStart = part.text.indexOf("\n{");
    if (jsonStart < 0) continue;
    try {
      const parsed = objectValue(JSON.parse(part.text.slice(jsonStart + 1)));
      if (parsed) return parsed;
    } catch {
      // Historical browser results are display data. Keep the compact card usable if parsing fails.
    }
  }
  return null;
}

function trustedBrowserUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function browserApplicationLabel(value: unknown): string {
  if (typeof value !== "string") return "系统默认浏览器";
  const applicationId = value.toLocaleLowerCase();
  if (applicationId.includes("edge")) return "Microsoft Edge";
  if (applicationId.includes("chrome")) return "Google Chrome";
  if (applicationId.includes("firefox")) return "Mozilla Firefox";
  if (applicationId.includes("safari")) return "Safari";
  return "系统默认浏览器";
}

function browserCallPreview(call: ToolCall): BrowserCallPreview | null {
  if (call.input?.operation !== "browser_computer_use") return null;
  const request = call.input.request;
  const payload = browserResultPayload(call);
  const observation = objectValue(payload?.observation);
  const session = objectValue(payload?.session);
  const descriptor = observation ?? session;
  const rawText = call.resultContent
    .filter(
      (part): part is Extract<ToolCall["resultContent"][number], { type: "text" }> =>
        part.type === "text",
    )
    .map(({ text }) => text)
    .join("\n");
  const image =
    [...call.resultContent]
      .reverse()
      .find(
        (part): part is Extract<ToolCall["resultContent"][number], { type: "image" }> =>
          part.type === "image",
      ) ?? null;
  const inputUrl = "url" in request ? request.url : null;
  const descriptorUrl = trustedBrowserUrl(descriptor?.url);
  return {
    callId: call.id,
    action: request.action,
    actionLabel: browserActionLabel[request.action] ?? `浏览器操作：${request.action}`,
    applicationLabel: browserApplicationLabel(descriptor?.applicationId),
    image,
    input: call.input,
    rawText,
    resultSummary: call.resultSummary,
    sessionId:
      typeof descriptor?.sessionId === "string"
        ? descriptor.sessionId
        : "sessionId" in request
          ? request.sessionId
          : null,
    state: typeof descriptor?.state === "string" ? descriptor.state : null,
    status: call.status,
    title: typeof observation?.title === "string" ? observation.title : null,
    url: descriptorUrl ?? trustedBrowserUrl(inputUrl),
  };
}

function browserTargetLabel(preview: BrowserCallPreview): string {
  if (preview.title) return preview.title;
  if (!preview.url) return preview.applicationLabel;
  try {
    return new URL(preview.url).hostname;
  } catch {
    return preview.applicationLabel;
  }
}

function browserActivityLabel(preview: BrowserCallPreview): string {
  if (preview.status !== "completed") {
    return `${preview.applicationLabel} · ${preview.actionLabel}`;
  }
  const completedAction = browserCompletedActionLabel[preview.action] ?? preview.actionLabel;
  return `在 ${preview.applicationLabel} 中${completedAction}`;
}

function BrowserToolCall({
  call,
  preview,
  onOpenPreview,
  embedded = false,
}: {
  call: ToolCall;
  preview: BrowserCallPreview;
  onOpenPreview: (preview: BrowserCallPreview) => void;
  embedded?: boolean;
}): React.JSX.Element {
  const discloseByDefault = ["failed", "waiting_for_permission"].includes(call.status);
  const content = (
    <div className="browser-activity-content">
      <div className="browser-activity-target">
        <strong>{browserTargetLabel(preview)}</strong>
        {preview.url ? <span title={preview.url}>{preview.url}</span> : null}
      </div>
      {preview.resultSummary ? <p>{preview.resultSummary}</p> : null}
      <div className="browser-activity-actions">
        {preview.image ? (
          <button type="button" onClick={() => onOpenPreview(preview)}>
            查看画面
          </button>
        ) : null}
        {preview.url ? (
          <a href={preview.url} rel="noreferrer" target="_blank">
            在浏览器中打开
          </a>
        ) : null}
        <details className="browser-activity-technical">
          <summary>技术详情</summary>
          <div>
            <strong>类型化输入</strong>
            <pre>{JSON.stringify(preview.input, null, 2)}</pre>
            {preview.rawText ? (
              <>
                <strong>原始结果</strong>
                <pre>{preview.rawText}</pre>
              </>
            ) : null}
          </div>
        </details>
      </div>
      {call.errorCode ? (
        <p className="inline-error">{toolRuntimeReasonLabels[call.errorCode] ?? call.errorCode}</p>
      ) : null}
    </div>
  );
  if (embedded) {
    return (
      <section
        className={`run-item-row tool-call-row browser-activity-embedded browser-activity-${call.status}`}
      >
        {content}
      </section>
    );
  }
  return (
    <details
      className={`run-item-row tool-call-row browser-activity-row browser-activity-${call.status}`}
      open={discloseByDefault || undefined}
    >
      <summary>
        <Desktop size={17} weight="regular" aria-hidden="true" />
        <span>{browserActivityLabel(preview)}</span>
        {call.status === "completed" ? null : (
          <small className="browser-activity-state">{toolCallStatusLabel[call.status]}</small>
        )}
        <CaretDown className="browser-activity-caret" size={13} weight="bold" aria-hidden="true" />
      </summary>
      {content}
    </details>
  );
}

function assistantActivityItems(
  items: WorkItemDetail["items"],
  segment: { index: number; count: number },
  historicalRun: boolean,
): WorkItemDetail["items"] {
  if (historicalRun) {
    return segment.index === 0 ? items.filter((item) => item.content.type !== "reasoning") : [];
  }
  const groupedItems = Array.from({ length: segment.count }, () => [] as WorkItemDetail["items"]);
  let modelRound = -1;
  for (const item of items) {
    if (item.content.type === "model") {
      modelRound += 1;
      continue;
    }
    if (item.content.type === "reasoning") continue;
    const targetIndex = Math.min(Math.max(modelRound, 0), segment.count - 1);
    groupedItems[targetIndex]?.push(item);
  }
  return groupedItems[segment.index] ?? [];
}

function assistantActivitySummary(
  items: WorkItemDetail["items"],
  toolCalls: ReadonlyMap<string, ToolCall>,
  projectedSources: ReadonlySet<string>,
  projectedDiffs: ReadonlySet<string>,
  projectedCommands: ReadonlySet<string>,
): string {
  const labels = items.flatMap((item) => {
    const content = item.content;
    if (content.type === "tool") {
      const call = toolCalls.get(content.toolCallId);
      const browserPreview = call ? browserCallPreview(call) : null;
      if (browserPreview) return [browserActivityLabel(browserPreview)];
      if (
        projectedSources.has(content.toolCallId) ||
        projectedDiffs.has(content.toolCallId) ||
        projectedCommands.has(content.toolCallId)
      ) {
        return [];
      }
      return [call?.inputSummary ?? content.inputSummary ?? content.toolName];
    }
    if (content.type === "command") return ["运行了命令"];
    if (content.type === "diff") return ["编辑了文件"];
    if (content.type === "source") return ["查看了来源"];
    if (content.type === "plan") return ["更新了执行计划"];
    if (content.type === "approval") return ["请求了工具授权"];
    if (content.type === "compaction") return ["压缩了上下文"];
    if (content.type === "model") return [content.summary];
    if (content.type === "retry") return ["重试了模型调用"];
    return [];
  });
  return [...new Set(labels)].join(" · ") || "工具调用";
}

function ToolActivity({
  workItem,
  onOpenBrowserPreview,
  segment,
  selectedRunId: controlledSelectedRunId,
  onSelectRun,
}: {
  workItem: WorkItem;
  onOpenBrowserPreview: (preview: BrowserCallPreview) => void;
  segment?: { index: number; count: number };
  selectedRunId?: string | null;
  onSelectRun?: (runId: string) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [localSelectedRunId, setLocalSelectedRunId] = useState(workItem.activeRunId);
  const selectedRunId =
    controlledSelectedRunId === undefined ? localSelectedRunId : controlledSelectedRunId;
  useEffect(() => {
    if (controlledSelectedRunId === undefined && !localSelectedRunId && workItem.activeRunId) {
      setLocalSelectedRunId(workItem.activeRunId);
    }
  }, [controlledSelectedRunId, localSelectedRunId, workItem.activeRunId]);
  const detail = useQuery({
    queryKey: ["tools", "work-item", workItem.id, selectedRunId],
    queryFn: () =>
      window.openerx.getWorkItem({
        workItemId: workItem.id,
        ...(selectedRunId ? { runId: selectedRunId } : {}),
      }),
  });
  const resolve = useMutation({
    mutationFn: ({
      permissionRequestId,
      decision,
      payloadDigest,
    }: {
      permissionRequestId: string;
      decision: "once" | "session" | "persistent" | "deny";
      payloadDigest: string;
    }) => window.openerx.resolvePermission({ permissionRequestId, decision, payloadDigest }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tools"] });
    },
  });
  const value: WorkItemDetail | undefined = detail.data;
  const toolCalls = new Map(value?.toolCalls.map((call) => [call.id, call]) ?? []);
  const permissions = new Map(
    value?.permissions.map((permission) => [permission.id, permission]) ?? [],
  );
  const projectedSources = new Set(
    value?.items.flatMap((item) =>
      item.content.type === "source" ? [item.content.toolCallId] : [],
    ) ?? [],
  );
  const projectedDiffs = new Set(
    value?.items.flatMap((item) =>
      item.content.type === "diff" ? [item.content.toolCallId] : [],
    ) ?? [],
  );
  const projectedCommands = new Set(
    value?.items.flatMap((item) =>
      item.content.type === "command" ? [item.content.toolCallId] : [],
    ) ?? [],
  );
  const usageRecords = value?.run.usageRecords ?? [];
  const usageTotal = usageRecords.reduce(
    (total, usage) => ({
      inputTokens: {
        known: total.inputTokens.known + (usage.inputTokens ?? 0),
        unknownRecords: total.inputTokens.unknownRecords + Number(usage.inputTokens === null),
      },
      cachedInputTokens: {
        known: total.cachedInputTokens.known + (usage.cachedInputTokens ?? 0),
        unknownRecords:
          total.cachedInputTokens.unknownRecords + Number(usage.cachedInputTokens === null),
      },
      outputTokens: {
        known: total.outputTokens.known + (usage.outputTokens ?? 0),
        unknownRecords: total.outputTokens.unknownRecords + Number(usage.outputTokens === null),
      },
      reasoningTokens: {
        known: total.reasoningTokens.known + (usage.reasoningTokens ?? 0),
        unknownRecords:
          total.reasoningTokens.unknownRecords + Number(usage.reasoningTokens === null),
      },
      totalTokens: {
        known: total.totalTokens.known + (usage.totalTokens ?? 0),
        unknownRecords: total.totalTokens.unknownRecords + Number(usage.totalTokens === null),
      },
    }),
    {
      inputTokens: { known: 0, unknownRecords: 0 },
      cachedInputTokens: { known: 0, unknownRecords: 0 },
      outputTokens: { known: 0, unknownRecords: 0 },
      reasoningTokens: { known: 0, unknownRecords: 0 },
      totalTokens: { known: 0, unknownRecords: 0 },
    },
  );
  const shouldOpen = ["running", "cancelling", "waiting_for_permission", "failed"].includes(
    workItem.status,
  );
  const elapsed = elapsedTime(workItem.createdAt, workItem.completedAt);
  const showTitle = elapsed && workItem.title !== "对话轮次";
  const showStatus = workItem.status !== "completed";
  const timelineItems = segment
    ? assistantActivityItems(
        value?.items ?? [],
        segment,
        Boolean(selectedRunId && selectedRunId !== workItem.activeRunId),
      )
    : (value?.items ?? []);
  const segmentLabel = assistantActivitySummary(
    timelineItems,
    toolCalls,
    projectedSources,
    projectedDiffs,
    projectedCommands,
  );
  const segmentUsesBrowser = timelineItems.some((item) => {
    if (item.content.type !== "tool") return false;
    const call = toolCalls.get(item.content.toolCallId);
    return call ? Boolean(browserCallPreview(call)) : false;
  });
  const showsSegmentMetadata = segment?.index === 0;
  const hasSegmentMetadata =
    showsSegmentMetadata &&
    (detail.isPending ||
      Boolean(detail.error) ||
      Boolean(value && (value.runs.length > 1 || usageRecords.length > 0)));
  if (segment && timelineItems.length === 0 && !hasSegmentMetadata) return <></>;
  const activityContent = (
    <>
      {detail.isPending && (!segment || segment.index === 0) ? (
        <p className="muted-copy">正在读取工具活动…</p>
      ) : null}
      {detail.error && (!segment || segment.index === 0) ? (
        <p className="inline-error">暂时无法读取工具活动。</p>
      ) : null}
      {(!segment || showsSegmentMetadata) && value && value.runs.length > 1 ? (
        <div className="run-replay-header">
          <span>
            Run #{value.run.attempt} · {value.run.selectedModelRef}
          </span>
          <label>
            历史 Run
            <select
              aria-label="选择要回放的 Run"
              value={value.run.id}
              onChange={(event) => {
                setLocalSelectedRunId(event.target.value);
                onSelectRun?.(event.target.value);
              }}
            >
              {value.runs.map((run) => (
                <option value={run.id} key={run.id}>
                  #{run.attempt} · {run.status}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {(!segment || showsSegmentMetadata) && usageRecords.length > 0 ? (
        <div className="usage-line" role="status" aria-label="执行轮次 Token 用量">
          <span>{usageRecords.length} 个模型轮次</span>
          <span>输入 {tokenValue(usageTotal.inputTokens)}</span>
          <span>缓存 {tokenValue(usageTotal.cachedInputTokens)}</span>
          <span>输出 {tokenValue(usageTotal.outputTokens)}</span>
          <span>推理 {tokenValue(usageTotal.reasoningTokens)}</span>
          <strong>总计 {tokenValue(usageTotal.totalTokens)}</strong>
        </div>
      ) : null}
      <div className="run-timeline">
        {timelineItems.map((item) => {
          const content = item.content;
          if (content.type === "tool") {
            const call = toolCalls.get(content.toolCallId);
            if (!call) return null;
            const browserPreview = browserCallPreview(call);
            if (browserPreview) {
              return (
                <BrowserToolCall
                  call={call}
                  embedded={Boolean(segment)}
                  key={item.id}
                  preview={browserPreview}
                  onOpenPreview={onOpenBrowserPreview}
                />
              );
            }
            const visibleParts = call.resultContent.filter(
              (part) =>
                !(part.type === "source" && projectedSources.has(call.id)) &&
                !(part.type === "diff" && projectedDiffs.has(call.id)) &&
                !(
                  part.type === "text" &&
                  projectedCommands.has(call.id) &&
                  call.input?.operation.startsWith("shell_")
                ),
            );
            return (
              <section className="run-item-row tool-call-row" key={item.id}>
                <header>
                  <div>
                    <strong>{call.toolName}</strong>
                    <span>{call.inputSummary}</span>
                  </div>
                  <span>{call.status}</span>
                </header>
                {call.input ? (
                  <details className="typed-input">
                    <summary>类型化输入 · {call.input.operation}</summary>
                    <pre>{JSON.stringify(call.input, null, 2)}</pre>
                  </details>
                ) : null}
                {call.resultSummary ? <p>{call.resultSummary}</p> : null}
                {visibleParts.map((part, index) => {
                  const key = `${call.id}:${index}`;
                  if (part.type === "image") {
                    return (
                      <img
                        alt={`${call.toolName} 返回的图片`}
                        className="tool-result-image"
                        key={key}
                        src={`data:${part.mimeType};base64,${part.data}`}
                      />
                    );
                  }
                  if (part.type === "text") return <pre key={key}>{part.text}</pre>;
                  if (part.type === "file") {
                    return (
                      <p key={key}>
                        文件：{part.displayName}（{part.mediaType}）
                      </p>
                    );
                  }
                  if (part.type === "artifact") return <p key={key}>成果：{part.artifactId}</p>;
                  if (part.type === "diff") {
                    return (
                      <details key={key}>
                        <summary>差异：{part.relativePath}</summary>
                        <pre>{part.patch}</pre>
                      </details>
                    );
                  }
                  return (
                    <a href={part.source.url} key={key} rel="noreferrer" target="_blank">
                      {part.source.title}
                    </a>
                  );
                })}
                {call.errorCode ? (
                  <p className="inline-error">
                    {toolRuntimeReasonLabels[call.errorCode] ?? call.errorCode}
                  </p>
                ) : null}
              </section>
            );
          }
          if (content.type === "approval") {
            const permission = permissions.get(content.permissionRequestId);
            if (!permission) return null;
            const persistentAllowed = ["L1", "L2", "L3"].includes(permission.risk);
            return (
              <section
                className="run-item-row permission-card"
                key={item.id}
                aria-label="工具权限确认"
              >
                <p className="eyebrow">
                  {permission.risk} 权限请求 · {permission.status}
                </p>
                <strong>{permission.reason}</strong>
                <span>
                  {permission.capability} · {permission.resource}
                </span>
                {permission.status === "pending" ? (
                  <div>
                    <button
                      type="button"
                      className="primary-action"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({
                          permissionRequestId: permission.id,
                          decision: "once",
                          payloadDigest: permission.payloadDigest,
                        })
                      }
                    >
                      仅本次允许
                    </button>
                    {persistentAllowed ? (
                      <button
                        type="button"
                        disabled={resolve.isPending}
                        onClick={() =>
                          resolve.mutate({
                            permissionRequestId: permission.id,
                            decision: "session",
                            payloadDigest: permission.payloadDigest,
                          })
                        }
                      >
                        在此对话中允许
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="danger-action"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({
                          permissionRequestId: permission.id,
                          decision: "deny",
                          payloadDigest: permission.payloadDigest,
                        })
                      }
                    >
                      拒绝
                    </button>
                  </div>
                ) : null}
              </section>
            );
          }
          if (content.type === "plan") {
            return (
              <section className="run-item-row" key={item.id}>
                <header>
                  <strong>执行计划</strong>
                  <span>{item.status}</span>
                </header>
                {content.explanation ? <p>{content.explanation}</p> : null}
                <ol className="run-plan">
                  {content.entries.map((entry) => (
                    <li data-status={entry.status} key={`${item.id}:${entry.text}`}>
                      <span>
                        {entry.status === "completed"
                          ? "✓"
                          : entry.status === "in_progress"
                            ? "●"
                            : "○"}
                      </span>
                      {entry.text}
                    </li>
                  ))}
                </ol>
              </section>
            );
          }
          if (content.type === "reasoning") {
            return (
              <section className="run-item-row" key={item.id}>
                <header>
                  <strong>推理摘要</strong>
                  <span>{item.status}</span>
                </header>
                <p>{content.summary}</p>
                {content.reasoningTokens === null ? null : (
                  <span>{content.reasoningTokens} reasoning tokens</span>
                )}
              </section>
            );
          }
          if (content.type === "model") {
            return (
              <section className="run-item-row" key={item.id}>
                <header>
                  <strong>模型轮次 · {content.modelRef}</strong>
                  <span>{item.status}</span>
                </header>
                <p>{content.summary}</p>
              </section>
            );
          }
          if (content.type === "command") {
            return (
              <section className="run-item-row command-item" key={item.id}>
                <header>
                  <strong>命令 · {[content.command, ...content.args].join(" ")}</strong>
                  <span>{item.status}</span>
                </header>
                {content.cwd ? <span>目录：{content.cwd}</span> : null}
                <pre>{content.output || "（没有命令输出）"}</pre>
                <span>
                  {content.processId ? `进程 ${content.processId} · ` : ""}
                  退出码 {content.exitCode ?? "—"}
                  {content.outputTruncated ? " · 输出已截断" : ""}
                </span>
              </section>
            );
          }
          if (content.type === "diff") {
            return (
              <section className="run-item-row" key={item.id}>
                <header>
                  <strong>文件差异 · {content.relativePath}</strong>
                  <span>{item.status}</span>
                </header>
                <pre>{content.patch}</pre>
              </section>
            );
          }
          if (content.type === "source") {
            return (
              <section className="run-item-row" key={item.id}>
                <header>
                  <strong>来源</strong>
                  <span>{item.status}</span>
                </header>
                <a href={content.source.url} rel="noreferrer" target="_blank">
                  {content.source.title}
                </a>
                {content.source.excerpt ? <p>{content.source.excerpt}</p> : null}
              </section>
            );
          }
          if (content.type === "compaction") {
            return (
              <section className="run-item-row" key={item.id}>
                <header>
                  <strong>上下文压缩 · {content.reason}</strong>
                  <span>{item.status}</span>
                </header>
                <p>
                  Token：{content.tokensBefore ?? "未知"} → {content.tokensAfter ?? "未知"}
                </p>
              </section>
            );
          }
          return (
            <section className="run-item-row" key={item.id}>
              <header>
                <strong>
                  模型重试 · {content.attempt}/{content.maxAttempts}
                </strong>
                <span>{item.status}</span>
              </header>
              <p>{content.summary}</p>
              <span>等待 {content.delayMs} ms</span>
            </section>
          );
        })}
      </div>
    </>
  );
  if (segment) {
    return (
      <details className="tool-activity tool-activity-segment">
        <summary>
          <span className="tool-activity-heading">
            {segmentUsesBrowser ? (
              <Desktop size={17} weight="regular" aria-hidden="true" />
            ) : (
              <TerminalWindow size={17} weight="regular" aria-hidden="true" />
            )}
            <span>{detail.isPending ? "正在读取工具调用…" : segmentLabel}</span>
            <CaretDown className="tool-activity-caret" size={13} weight="bold" aria-hidden="true" />
          </span>
          {showStatus ? (
            <span className={`tool-state tool-state-${workItem.status}`}>
              {workItemStatusLabel[workItem.status]}
            </span>
          ) : null}
        </summary>
        {activityContent}
      </details>
    );
  }
  return (
    <details className="tool-activity" open={shouldOpen || undefined}>
      <summary>
        <span className="tool-activity-heading">
          <strong>{elapsed ? `用时 ${elapsed}` : workItem.title}</strong>
          {showTitle ? <span className="tool-activity-title">{workItem.title}</span> : null}
          <CaretDown className="tool-activity-caret" size={13} weight="bold" aria-hidden="true" />
        </span>
        {showStatus ? (
          <span className={`tool-state tool-state-${workItem.status}`}>
            {workItemStatusLabel[workItem.status]}
          </span>
        ) : null}
      </summary>
      {activityContent}
    </details>
  );
}

function ConversationToolbar({
  snapshot,
  railOpen,
  onToggleRail,
}: {
  snapshot: ConversationSnapshot;
  railOpen: boolean;
  onToggleRail: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const conversation = snapshot.conversation;
  const [renaming, setRenaming] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [projectMoveOpen, setProjectMoveOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [forgetSourceMemories, setForgetSourceMemories] = useState(false);
  const [nextTitle, setNextTitle] = useState(conversation.title);
  const [selectedBranchId, setSelectedBranchId] = useState(conversation.activeBranchId);
  const [toolbarNotice, setToolbarNotice] = useState<string | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setSelectedBranchId(conversation.activeBranchId), [conversation.activeBranchId]);
  useEffect(() => {
    if (moreOpen) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [moreOpen]);
  useEffect(() => {
    if (renaming) window.requestAnimationFrame(() => renameInputRef.current?.focus());
  }, [renaming]);
  const rename = useMutation({
    mutationFn: (title: string) =>
      window.openerx.renameConversation({ conversationId: conversation.id, title }),
    onSuccess: async (updated) => {
      queryClient.setQueryData<ConversationSnapshot>(
        chatKeys.conversation(conversation.id),
        (current) => (current ? { ...current, conversation: updated } : current),
      );
      await queryClient.invalidateQueries({ queryKey: ["chat", "list"] });
      setRenaming(false);
      setToolbarNotice("对话标题已更新。");
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      window.openerx.setConversationArchived({
        conversationId: conversation.id,
        archived: conversation.archivedAt === null,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData<ConversationSnapshot>(
        chatKeys.conversation(conversation.id),
        (current) => (current ? { ...current, conversation: updated } : current),
      );
      await queryClient.invalidateQueries({ queryKey: ["chat", "list"] });
      setToolbarNotice(updated.archivedAt ? "对话已归档。" : "对话已移回活动历史。");
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      window.openerx.deleteConversation({
        conversationId: conversation.id,
        forgetSourceMemories,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
      navigate("/chat/new");
    },
  });
  const activate = useMutation({
    mutationFn: (branchId: string) =>
      window.openerx.activateBranch({ conversationId: conversation.id, branchId }),
    onSuccess: (next) => {
      setSelectedBranchId(next.conversation.activeBranchId);
      queryClient.setQueryData(chatKeys.conversation(conversation.id), next);
      setToolbarNotice(
        `已切换到${next.branches.find(({ id }) => id === next.conversation.activeBranchId)?.label ?? "所选分支"}。`,
      );
    },
    onError: () => setSelectedBranchId(conversation.activeBranchId),
  });
  const usage = useQuery({
    queryKey: ["usage", "conversation", conversation.id],
    queryFn: () => window.openerx.getUsage({ conversationId: conversation.id }),
    retry: false,
  });
  return (
    <header className="conversation-toolbar">
      <div className="conversation-heading">
        <h1>{conversation.title}</h1>
        <ConversationProjectBadge projectId={conversation.projectId} />
      </div>
      <div className="toolbar-actions">
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label={railOpen ? "隐藏成果与来源" : "显示成果与来源"}
          aria-pressed={railOpen}
          onClick={onToggleRail}
        >
          <SidebarSimple size={17} weight="regular" />
        </button>
        <button
          ref={moreButtonRef}
          type="button"
          className="toolbar-icon-button"
          aria-label="更多操作"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <SlidersHorizontal size={17} weight="regular" />
        </button>
        {snapshot.branches.length > 1 ? (
          <label>
            分支
            <select
              aria-label="选择对话分支"
              value={selectedBranchId}
              onChange={(event) => {
                setSelectedBranchId(event.target.value);
                activate.mutate(event.target.value);
              }}
              disabled={activate.isPending}
            >
              {snapshot.branches.map((branch) => (
                <option value={branch.id} key={branch.id}>
                  {branch.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {moreOpen ? (
          <div
            ref={menuRef}
            className="conversation-menu"
            role="menu"
            aria-label="对话操作"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setMoreOpen(false);
                window.requestAnimationFrame(() => moreButtonRef.current?.focus());
              }
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                setRenaming(true);
              }}
            >
              重命名
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                setProjectMoveOpen(true);
              }}
            >
              {conversation.projectId ? "更改或移出项目…" : "移动到项目…"}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={archive.isPending}
              onClick={() => {
                setMoreOpen(false);
                archive.mutate();
                window.requestAnimationFrame(() => moreButtonRef.current?.focus());
              }}
            >
              {conversation.archivedAt ? "取消归档" : "归档对话"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger-action"
              onClick={() => {
                setMoreOpen(false);
                setForgetSourceMemories(false);
                setConfirmingDelete(true);
              }}
            >
              删除对话…
            </button>
          </div>
        ) : null}
      </div>
      {renaming ? (
        <form
          className="rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            const title = nextTitle.trim();
            if (title) rename.mutate(title);
          }}
        >
          <label htmlFor="conversation-title">对话标题</label>
          <input
            ref={renameInputRef}
            id="conversation-title"
            value={nextTitle}
            onChange={(event) => setNextTitle(event.target.value)}
          />
          <button type="submit" disabled={!nextTitle.trim() || rename.isPending}>
            保存
          </button>
          <button type="button" onClick={() => setRenaming(false)}>
            取消
          </button>
        </form>
      ) : null}
      {confirmingDelete ? (
        <ConfirmDialog
          title="删除这个对话？"
          description="删除后将不再出现在历史记录中。此操作无法在应用内撤销。"
          confirmLabel="确认删除"
          pending={remove.isPending}
          onCancel={() => {
            setConfirmingDelete(false);
            window.setTimeout(() => moreButtonRef.current?.focus(), 0);
          }}
          onConfirm={() => remove.mutate()}
        >
          <label className="confirmation-dialog-option">
            <input
              type="checkbox"
              checked={forgetSourceMemories}
              onChange={(event) => setForgetSourceMemories(event.target.checked)}
            />
            <span>
              同时删除仅来源于此对话的长期记忆
              <small>其他对话或手动创建的记忆不受影响。</small>
            </span>
          </label>
        </ConfirmDialog>
      ) : null}
      {projectMoveOpen ? (
        <ConversationProjectMoveDialog
          conversation={conversation}
          onClose={() => {
            setProjectMoveOpen(false);
            window.setTimeout(() => moreButtonRef.current?.focus(), 0);
          }}
          onMoved={(projectName) =>
            setToolbarNotice(
              projectName
                ? `对话已移入“${projectName}”；项目上下文从下一轮开始生效。`
                : "对话已移出项目；项目上下文从下一轮起移除。",
            )
          }
        />
      ) : null}
      <div className="toolbar-feedback" aria-live="polite">
        {toolbarNotice ? <p>{toolbarNotice}</p> : null}
        {rename.error || archive.error || activate.error ? (
          <p className="inline-error">
            {userFacingError(
              rename.error ?? archive.error ?? activate.error,
              "对话操作暂时没有完成，请重试。",
            )}
          </p>
        ) : null}
      </div>
      {usage.data && usage.data.records > 0 ? (
        <div className="conversation-usage">
          {usage.data.records} 次模型调用 · Token {tokenValue(usage.data.totalTokens)}
        </div>
      ) : null}
    </header>
  );
}

function browserSessionStateLabel(state: string | null): string {
  switch (state) {
    case "opening":
      return "正在打开";
    case "active":
      return "自动操作中";
    case "paused_for_user":
      return "用户已接管";
    case "detached":
      return "已交还浏览器";
    case "closing":
      return "正在关闭";
    case "closed":
      return "会话已关闭";
    case "failed":
      return "浏览器会话失败";
    default:
      return "画面快照";
  }
}

function BrowserPreviewRail({
  preview,
  onBack,
  onClose,
}: {
  preview: BrowserCallPreview;
  onBack: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <aside
      className="conversation-rail conversation-rail-preview browser-preview-rail"
      aria-label="浏览器画面"
    >
      <header className="conversation-rail-header artifact-preview-header">
        <button
          type="button"
          className="artifact-preview-back"
          aria-label="返回成果与来源"
          onClick={onBack}
        >
          <ArrowLeft size={17} weight="regular" />
        </button>
        <div>
          <strong>{preview.title ?? preview.actionLabel}</strong>
          <span>
            {preview.applicationLabel} · {browserSessionStateLabel(preview.state)}
          </span>
        </div>
        <button type="button" className="icon-button" aria-label="隐藏浏览器画面" onClick={onClose}>
          <X size={17} weight="regular" />
        </button>
      </header>
      <div className="browser-preview-toolbar">
        <div>
          <Desktop size={16} weight="regular" aria-hidden="true" />
          <span>{preview.actionLabel}</span>
        </div>
        {preview.url ? (
          <a href={preview.url} rel="noreferrer" target="_blank">
            在浏览器中打开
          </a>
        ) : null}
      </div>
      <section className="browser-preview-body" aria-live="polite">
        {preview.image ? (
          <img
            alt={`${preview.title ?? preview.applicationLabel}的浏览器画面`}
            src={`data:${preview.image.mimeType};base64,${preview.image.data}`}
          />
        ) : (
          <div className="artifact-preview-state">这次操作没有返回浏览器截图。</div>
        )}
        <dl className="browser-preview-meta">
          <div>
            <dt>状态</dt>
            <dd>{toolCallStatusLabel[preview.status]}</dd>
          </div>
          {preview.url ? (
            <div>
              <dt>网址</dt>
              <dd title={preview.url}>{preview.url}</dd>
            </div>
          ) : null}
          {preview.sessionId ? (
            <div>
              <dt>会话</dt>
              <dd>{preview.sessionId}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </aside>
  );
}

function ConversationRail({
  artifacts,
  files,
  workItems,
  selectedBrowserPreview,
  selectedArtifactId,
  onSelectArtifact,
  onBackFromBrowserPreview,
  onBackToOverview,
  onAddSource,
  onClose,
}: {
  artifacts: Artifact[];
  files: PersonalFile[];
  workItems: WorkItem[];
  selectedBrowserPreview: BrowserCallPreview | null;
  selectedArtifactId: string | null;
  onSelectArtifact: (artifactId: string) => void;
  onBackFromBrowserPreview: () => void;
  onBackToOverview: () => void;
  onAddSource: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");
  const selectedArtifact = artifacts.find(({ id }) => id === selectedArtifactId) ?? null;
  const preview = useQuery({
    queryKey: ["content-preview", "artifact", selectedArtifactId, selectedArtifact?.currentVersion],
    queryFn: () => {
      if (!selectedArtifactId) throw new Error("No artifact selected");
      return window.openerx.previewArtifact({ artifactId: selectedArtifactId });
    },
    enabled: selectedArtifactId !== null,
    retry: false,
  });
  const saveArtifact = useMutation({
    mutationFn: async (artifactId: string) => await window.openerx.saveArtifact({ artifactId }),
  });
  useEffect(() => {
    if (!selectedArtifactId && !selectedBrowserPreview) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (selectedBrowserPreview) onBackFromBrowserPreview();
      else onBackToOverview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBackFromBrowserPreview, onBackToOverview, selectedArtifactId, selectedBrowserPreview]);

  if (selectedBrowserPreview) {
    return (
      <BrowserPreviewRail
        preview={selectedBrowserPreview}
        onBack={onBackFromBrowserPreview}
        onClose={onClose}
      />
    );
  }

  if (selectedArtifactId) {
    return (
      <aside className="conversation-rail conversation-rail-preview" aria-label="成果预览">
        <header className="conversation-rail-header artifact-preview-header">
          <button
            type="button"
            className="artifact-preview-back"
            aria-label="返回输出内容"
            onClick={onBackToOverview}
          >
            <ArrowLeft size={17} weight="regular" />
          </button>
          <div>
            <strong>
              {selectedArtifact?.displayName ?? preview.data?.displayName ?? "正在加载…"}
            </strong>
            <span>
              {selectedArtifact
                ? `${selectedArtifact.format.toUpperCase()} · v${selectedArtifact.currentVersion}`
                : "受控成果预览"}
            </span>
          </div>
          <button type="button" className="icon-button" aria-label="隐藏成果预览" onClick={onClose}>
            <X size={17} weight="regular" />
          </button>
        </header>
        <div className="artifact-preview-toolbar">
          {preview.data && preview.data.source !== null ? (
            <fieldset className="artifact-preview-modes" aria-label="预览模式">
              <button
                type="button"
                className={previewMode === "preview" ? "is-active" : ""}
                aria-pressed={previewMode === "preview"}
                onClick={() => setPreviewMode("preview")}
              >
                预览
              </button>
              <button
                type="button"
                className={previewMode === "source" ? "is-active" : ""}
                aria-pressed={previewMode === "source"}
                onClick={() => setPreviewMode("source")}
              >
                源码
              </button>
            </fieldset>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={!selectedArtifact || saveArtifact.isPending}
            onClick={() => selectedArtifact && saveArtifact.mutate(selectedArtifact.id)}
          >
            <DownloadSimple size={15} />
            {saveArtifact.isPending ? "保存中…" : "下载 / 另存"}
          </button>
        </div>
        <section className="artifact-preview-body" aria-live="polite">
          {preview.error ? (
            <div className="artifact-preview-state">
              <p className="inline-error">
                {userFacingError(preview.error, "暂时无法预览成果，请重试。")}
              </p>
              <button type="button" onClick={() => void preview.refetch()}>
                重试
              </button>
            </div>
          ) : preview.data ? (
            <ContentPreviewRenderer
              preview={preview.data}
              previewMode={previewMode}
              ariaLabel={`${preview.data.displayName} 视觉预览`}
            />
          ) : (
            <div className="artifact-preview-state">正在准备预览…</div>
          )}
          {saveArtifact.error ? (
            <p className="inline-error">
              {userFacingError(saveArtifact.error, "成果保存失败，请重试。")}
            </p>
          ) : null}
          {saveArtifact.data ? (
            <p className="inline-success">已保存 {saveArtifact.data.fileName}</p>
          ) : null}
        </section>
      </aside>
    );
  }

  return (
    <aside className="conversation-rail" aria-label="成果与来源">
      <header className="conversation-rail-header">
        <div>
          <strong>成果与来源</strong>
          <span>与回复并排查看</span>
        </div>
        <button type="button" className="icon-button" aria-label="隐藏成果与来源" onClick={onClose}>
          <X size={17} weight="regular" />
        </button>
      </header>

      <section className="rail-section" aria-labelledby="rail-outputs-title">
        <div className="rail-section-heading">
          <h2 id="rail-outputs-title">输出内容</h2>
          <NavLink to="/files" aria-label="查看全部成果" title="查看全部成果">
            <Plus size={17} weight="regular" />
          </NavLink>
        </div>
        {artifacts.length > 0 ? (
          <div className="rail-list">
            {artifacts.slice(0, 6).map((artifact) => (
              <button
                className="rail-item"
                type="button"
                key={artifact.id}
                aria-label={`预览 ${artifact.displayName}`}
                onClick={() => {
                  setPreviewMode("preview");
                  onSelectArtifact(artifact.id);
                }}
              >
                <FolderSimple size={18} weight="regular" />
                <span>
                  <strong>{artifact.displayName}</strong>
                  <small>
                    {artifact.format.toUpperCase()} · v{artifact.currentVersion}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rail-empty">创建的文件、报告和页面会出现在这里。</p>
        )}
      </section>

      <section className="rail-section" aria-labelledby="rail-sources-title">
        <div className="rail-section-heading">
          <h2 id="rail-sources-title">来源</h2>
          <button type="button" aria-label="添加来源" title="添加来源" onClick={onAddSource}>
            <Plus size={17} weight="regular" />
          </button>
        </div>
        {files.length > 0 ? (
          <div className="rail-list">
            {files.map((file) => (
              <button className="rail-item" type="button" key={file.id} onClick={onAddSource}>
                <FileText size={18} weight="regular" />
                <span>
                  <strong>{file.displayName}</strong>
                  <small>{file.parseStatus === "ready" ? "已解析" : "处理中"}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="rail-empty rail-empty-action" onClick={onAddSource}>
            添加文件、工作区或其他上下文来源。
          </button>
        )}
      </section>

      <section className="rail-section rail-runs" aria-labelledby="rail-runs-title">
        <div className="rail-section-heading">
          <h2 id="rail-runs-title">本次运行</h2>
          <span>{workItems.length}</span>
        </div>
        {workItems.slice(-4).map((workItem) => (
          <div className="rail-run" key={workItem.id}>
            <TerminalWindow size={17} weight="regular" />
            <span>
              <strong>{workItem.title}</strong>
              <small>
                {elapsedTime(workItem.createdAt, workItem.completedAt)
                  ? `用时 ${elapsedTime(workItem.createdAt, workItem.completedAt)}`
                  : workItemStatusLabel[workItem.status]}
              </small>
            </span>
          </div>
        ))}
      </section>
    </aside>
  );
}

function ChatPage({
  contextOpen,
  onToggleContext,
}: {
  contextOpen: boolean;
  onToggleContext: () => void;
}): React.JSX.Element {
  const { conversationId = "" } = useParams();
  const messageListRef = useRef<HTMLElement>(null);
  const messageListContentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const lastMessageListScrollTopRef = useRef(0);
  const previousConversationIdRef = useRef(conversationId);
  const [following, setFollowing] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedBrowserPreview, setSelectedBrowserPreview] = useState<BrowserCallPreview | null>(
    null,
  );
  const snapshot = useQuery({
    queryKey: chatKeys.conversation(conversationId),
    queryFn: () => window.openerx.getConversation({ conversationId }),
    enabled: Boolean(conversationId),
  });
  const conversationFiles = useQuery({
    queryKey: ["files", "conversation", conversationId],
    queryFn: () => window.openerx.listFiles({ conversationId }),
    enabled: Boolean(conversationId),
  });
  const artifacts = useQuery({
    queryKey: ["artifacts", "conversation", conversationId],
    queryFn: () => window.openerx.listArtifacts({ conversationId }),
    enabled: Boolean(conversationId),
  });
  const ready = Boolean(snapshot.data);
  const hasRunningMessage =
    snapshot.data?.messages.some(
      (message) =>
        message.role === "assistant" && ["pending", "streaming"].includes(message.status),
    ) ?? false;
  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) return;
    previousConversationIdRef.current = conversationId;
    followingRef.current = true;
    lastMessageListScrollTopRef.current = 0;
    setFollowing(true);
    setSelectedArtifactId(null);
    setSelectedBrowserPreview(null);
  }, [conversationId]);
  useEffect(() => {
    if (!ready) return;
    const messageList = messageListRef.current;
    if (!messageList) return;
    const updateFollowing = (): void => {
      const scrollTop = messageList.scrollTop;
      const distanceFromBottom = messageList.scrollHeight - (scrollTop + messageList.clientHeight);
      const movedUp = scrollTop < lastMessageListScrollTopRef.current - 1;
      let next = followingRef.current;
      if (movedUp) next = false;
      else if (distanceFromBottom <= 140) next = true;
      lastMessageListScrollTopRef.current = scrollTop;
      followingRef.current = next;
      setFollowing((current) => (current === next ? current : next));
    };
    lastMessageListScrollTopRef.current = messageList.scrollTop;
    messageList.addEventListener("scroll", updateFollowing, { passive: true });
    return () => messageList.removeEventListener("scroll", updateFollowing);
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    const messageList = messageListRef.current;
    const messageListContent = messageListContentRef.current;
    if (!messageList || !messageListContent) return;
    let scheduledFrame: number | null = null;
    const scheduleFollow = (): void => {
      if (!followingRef.current) return;
      if (scheduledFrame !== null) return;
      scheduledFrame = window.requestAnimationFrame(() => {
        scheduledFrame = null;
        if (followingRef.current) {
          scrollMessageListToEnd(messageList);
          lastMessageListScrollTopRef.current = messageList.scrollTop;
        }
      });
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleFollow);
    resizeObserver?.observe(messageListContent);
    const mutationObserver = new MutationObserver(scheduleFollow);
    mutationObserver.observe(messageListContent, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    scheduleFollow();
    return () => {
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      if (scheduledFrame !== null) window.cancelAnimationFrame(scheduledFrame);
    };
  }, [ready]);
  const workItems = useQuery({
    queryKey: ["tools", "work-items", conversationId],
    queryFn: () => window.openerx.listWorkItems({ conversationId, limit: 100 }),
    enabled: Boolean(conversationId),
  });
  if (snapshot.isPending) return <main className="center-state">正在恢复对话…</main>;
  if (snapshot.error || !snapshot.data) {
    return (
      <main className="center-state inline-error">无法读取对话：{snapshot.error?.message}</main>
    );
  }
  const filesById = new Map((conversationFiles.data ?? []).map((file) => [file.id, file] as const));
  return (
    <main
      className={`conversation-workspace ${railOpen ? "rail-is-open" : ""} ${selectedArtifactId ? "artifact-preview-is-open" : ""} ${selectedBrowserPreview ? "browser-preview-is-open" : ""}`}
    >
      <section className="conversation-page" aria-label="对话工作区">
        <ConversationToolbar
          snapshot={snapshot.data}
          railOpen={railOpen}
          onToggleRail={() => setRailOpen((open) => !open)}
        />
        <section
          ref={messageListRef}
          className="message-list"
          aria-live="polite"
          aria-atomic="false"
          aria-relevant="additions text"
          aria-label="对话消息"
        >
          <div ref={messageListContentRef} className="message-list-content">
            {snapshot.data.messages.map((message) => {
              const activities = (workItems.data ?? []).filter(
                (workItem) => workItem.messageId === message.id,
              );
              return (
                <section className={`message-stack message-stack-${message.role}`} key={message.id}>
                  {message.role === "user" ? (
                    <time className="turn-timestamp" dateTime={message.createdAt}>
                      {messageTimestamp(message.createdAt)}
                    </time>
                  ) : null}
                  <MessageCard
                    message={message}
                    attachments={snapshot.data.attachments.filter(
                      ({ messageId }) => messageId === message.id,
                    )}
                    filesById={filesById}
                    activities={message.role === "assistant" ? activities : []}
                    onOpenBrowserPreview={(preview) => {
                      setSelectedArtifactId(null);
                      setSelectedBrowserPreview(preview);
                      setRailOpen(true);
                    }}
                  />
                  {message.role !== "assistant"
                    ? activities.map((workItem) => (
                        <ToolActivity
                          key={workItem.id}
                          workItem={workItem}
                          onOpenBrowserPreview={(preview) => {
                            setSelectedArtifactId(null);
                            setSelectedBrowserPreview(preview);
                            setRailOpen(true);
                          }}
                        />
                      ))
                    : null}
                </section>
              );
            })}
          </div>
        </section>
        {hasRunningMessage && !following ? (
          <button
            type="button"
            className="jump-to-latest"
            onClick={() => {
              followingRef.current = true;
              setFollowing(true);
              scrollMessageListToEnd(messageListRef.current, "smooth");
            }}
          >
            <CaretDown size={15} />
            回到最新回复
          </button>
        ) : null}
        <Composer
          conversationId={conversationId}
          conversationSnapshot={snapshot.data}
          onOpenContext={onToggleContext}
          contextOpen={contextOpen}
        />
      </section>
      {railOpen ? (
        <ConversationRail
          artifacts={artifacts.data ?? []}
          files={conversationFiles.data ?? []}
          workItems={workItems.data ?? []}
          selectedBrowserPreview={selectedBrowserPreview}
          selectedArtifactId={selectedArtifactId}
          onSelectArtifact={(artifactId) => {
            setSelectedBrowserPreview(null);
            setSelectedArtifactId(artifactId);
          }}
          onBackFromBrowserPreview={() => setSelectedBrowserPreview(null)}
          onBackToOverview={() => setSelectedArtifactId(null)}
          onAddSource={onToggleContext}
          onClose={() => {
            setSelectedArtifactId(null);
            setSelectedBrowserPreview(null);
            setRailOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

function SearchPage(): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);
  const results = useQuery({
    queryKey: ["chat", "search", query, includeArchived],
    queryFn: () => window.openerx.search({ query, includeArchived }),
    enabled: Boolean(query),
  });
  return (
    <main className="search-page">
      <p className="eyebrow">本地历史</p>
      <h1>搜索对话</h1>
      <p className="page-intro">查找标题和消息正文；结果保留在本机工作区中。</p>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <input
          ref={searchInputRef}
          id="global-search-input"
          aria-label="搜索关键词"
          placeholder="输入标题或消息内容"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          搜索
        </button>
      </form>
      <label className="search-scope">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(event) => setIncludeArchived(event.target.checked)}
        />
        同时搜索已归档对话
      </label>
      <div className="search-results">
        {results.data?.map((result) => (
          <NavLink
            key={`${result.conversationId}-${result.messageId}`}
            to={`/chat/${result.conversationId}`}
          >
            <div className="search-result-heading">
              <strong>
                <HighlightedText text={result.title} query={query} />
              </strong>
              <time dateTime={result.updatedAt}>{formatUpdatedAt(result.updatedAt)}</time>
            </div>
            <span>
              <HighlightedText text={result.excerpt} query={query} />
            </span>
            <small>{result.messageId ? "消息正文" : "对话标题"}</small>
          </NavLink>
        ))}
        {!query ? (
          <div className="empty-state">
            <MagnifyingGlass size={26} />
            <strong>从历史对话中快速定位内容</strong>
            <p>按 ⌘K 可以随时来到这里。输入完整词组通常能得到更精确的结果。</p>
          </div>
        ) : null}
        {query && results.data?.length === 0 ? (
          <div className="empty-state">
            <strong>没有找到“{query}”</strong>
            <p>尝试更短的关键词，或开启“同时搜索已归档对话”。</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Placeholder({ title }: { title: string }): React.JSX.Element {
  return (
    <main className="placeholder-page">
      <p className="eyebrow">后续检查点</p>
      <h1>{title}</h1>
      <p>该领域尚未进入当前 M1 Chat Alpha 的实现范围。</p>
    </main>
  );
}

function skillSourceKindLabel(sourceKind: string): string {
  switch (sourceKind) {
    case "built_in":
      return "内置包";
    case "local_directory":
      return "本地目录";
    case "archive":
      return "本地 ZIP";
    default:
      return "已安装包";
  }
}

function skillSourceLabel(skill: SkillInstallation): string {
  return skill.sourceKind === "built_in"
    ? `${desktopBrand.productName} 内置 Skill`
    : skill.sourceLabel;
}

function skillTrustLabel(trust: SkillInstallation["trust"]): string {
  switch (trust) {
    case "bundled":
      return "内置";
    case "signed":
      return "已验证来源";
    case "unverified":
      return "未验证来源";
  }
}

function skillPlatformLabel(platform: string): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}

function skillToolLabel(tool: string): string {
  if (tool === "openerx_skill_script") return "Skill 脚本执行器";
  if (tool === "openerx_skill_resource") return "Skill 资源读取器";
  return tool.replaceAll("_", " ");
}

function skillCapabilityLabel(capability: string): string {
  const labels: Record<string, string> = {
    file: "文件",
    network: "网络",
    shell: "本地命令",
    browser: "浏览器",
    desktop: "桌面控制",
    mcp: "MCP 服务",
  };
  return labels[capability] ?? capability;
}

function skillActionLabel(action: string): string {
  const labels: Record<string, string> = {
    read: "读取",
    write: "写入",
    execute: "执行",
    connect: "连接",
    control: "控制",
  };
  return labels[action] ?? action;
}

function skillReasonLabel(reason: string): string {
  if (reason === "Run the bundled deterministic report outline script.") {
    return "运行内置的确定性报告大纲脚本。";
  }
  if (reason === "Selected from the composer") return "在消息输入区手动选择";
  return reason;
}

function SkillCenter(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"personal" | "workspace">("personal");
  const [skillQuery, setSkillQuery] = useState("");
  const [resetTarget, setResetTarget] = useState<SkillInstallation | null>(null);
  const [skillNotice, setSkillNotice] = useState<string | null>(null);
  const skills = useQuery({
    queryKey: ["skills"],
    queryFn: () => window.openerx.listSkills(),
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
  };
  const install = useMutation({
    mutationFn: () =>
      window.openerx.chooseAndInstallSkill({
        scope,
        workspaceId: scope === "workspace" ? "default" : null,
      }),
    onSuccess: async (installed) => {
      await refresh();
      setSkillNotice(installed ? `已安装 ${skillName(installed)}。` : "已取消安装。");
    },
  });
  const enable = useMutation({
    mutationFn: ({ installationId, enabled }: { installationId: string; enabled: boolean }) =>
      window.openerx.setSkillEnabled({ installationId, enabled }),
    onSuccess: refresh,
  });
  const autoInvoke = useMutation({
    mutationFn: ({ installationId, value }: { installationId: string; value: boolean }) =>
      window.openerx.setSkillAutoInvoke({ installationId, autoInvoke: value }),
    onSuccess: refresh,
  });
  const approve = useMutation({
    mutationFn: (skill: SkillInstallation) =>
      window.openerx.approveSkillPermissions({
        installationId: skill.id,
        permissionDigest: skill.permissionDigest,
      }),
    onSuccess: refresh,
  });
  const reset = useMutation({
    mutationFn: (installationId: string) =>
      window.openerx.resetSkillPermissions({ installationId }),
    onSuccess: async () => {
      await refresh();
      setSkillNotice("已撤销权限并停用该 Skill；重新审核批准后才能再次启用。");
      setResetTarget(null);
    },
  });
  const update = useMutation({
    mutationFn: (installationId: string) => window.openerx.chooseAndUpdateSkill({ installationId }),
    onSuccess: refresh,
  });
  const rollback = useMutation({
    mutationFn: ({ installationId, version }: { installationId: string; version: string }) =>
      window.openerx.rollbackSkill({ installationId, version }),
    onSuccess: refresh,
  });
  const uninstall = useMutation({
    mutationFn: (installationId: string) => window.openerx.uninstallSkill({ installationId }),
    onSuccess: refresh,
  });
  const mutationError =
    install.error ??
    enable.error ??
    autoInvoke.error ??
    approve.error ??
    reset.error ??
    update.error ??
    rollback.error ??
    uninstall.error;
  const visibleSkills = (skills.data ?? []).filter((skill) =>
    `${skillName(skill)} ${skillDescription(skill)}`
      .toLocaleLowerCase()
      .includes(skillQuery.trim().toLocaleLowerCase()),
  );

  return (
    <section
      className="settings-section-panel skill-center-page"
      id="assistants-section"
      tabIndex={-1}
      aria-label="skill 设置"
    >
      <header className="skill-center-header">
        <div>
          <h2>Skill</h2>
          <p>Skill 会为助手增加专门的工作方式。仅在任务需要时加载，并始终遵循当前权限。</p>
        </div>
        <button
          type="button"
          className="primary-action skill-install-button"
          onClick={() => install.mutate()}
          disabled={install.isPending}
        >
          <Plus size={16} weight="bold" /> 安装 Skill
        </button>
      </header>

      <div className="skill-toolbar">
        <label className="skill-filter">
          <MagnifyingGlass size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索 Skill"
            placeholder="搜索已安装的 Skill"
            value={skillQuery}
            onChange={(event) => setSkillQuery(event.target.value)}
          />
        </label>
        <label className="skill-scope-control">
          <span>安装到</span>
          <select
            aria-label="Skill 安装范围"
            value={scope}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            <option value="personal">个人</option>
            <option value="workspace">默认工作区</option>
          </select>
        </label>
      </div>
      <p className="skill-scope-note" aria-live="polite">
        新 Skill 将安装到{scope === "personal" ? "当前个人账户" : "本机默认工作区"}。
      </p>

      {skills.isPending ? <p>正在读取 Skill…</p> : null}
      {skills.error ? (
        <p className="inline-error">{userFacingError(skills.error, "暂时无法读取 Skill。")}</p>
      ) : null}
      {mutationError ? (
        <p className="inline-error">
          {userFacingError(mutationError, "Skill 操作暂时没有完成，请重试。")}
        </p>
      ) : null}
      {skillNotice && !mutationError ? (
        <p className="inline-success" role="status">
          {skillNotice}
        </p>
      ) : null}
      {!skills.isPending && skills.data && visibleSkills.length === 0 ? (
        <div className="empty-state skill-empty-state">
          <MagnifyingGlass size={24} />
          <strong>
            {skillQuery.trim() ? `没有匹配“${skillQuery.trim()}”的 Skill` : "还没有 Skill"}
          </strong>
          <p>
            {skillQuery.trim() ? "尝试更短的关键词，或清除搜索。" : "可从本地目录或 ZIP 安装。"}
          </p>
          {skillQuery.trim() ? (
            <button type="button" onClick={() => setSkillQuery("")}>
              清除搜索
            </button>
          ) : null}
        </div>
      ) : null}
      <section className="skill-grid" aria-label="已安装 Skill">
        {visibleSkills.map((skill) => {
          const approvalRequired =
            skill.permissions.length > 0 &&
            skill.approvedPermissionDigest !== skill.permissionDigest;
          return (
            <article className={`skill-card skill-state-${skill.packageState}`} key={skill.id}>
              <header className="skill-card-header">
                <div className="skill-identity">
                  <span className="skill-icon" aria-hidden="true">
                    <Sparkle size={18} weight="fill" />
                  </span>
                  <div>
                    <div className="skill-card-meta">
                      <span className={`skill-trust trust-${skill.trust}`}>
                        {skillTrustLabel(skill.trust)}
                      </span>
                      <span>v{skill.version}</span>
                    </div>
                    <h3>{skillName(skill)}</h3>
                    <p>{skillDescription(skill)}</p>
                  </div>
                </div>
                <div className="skill-primary-control">
                  <span className={`skill-enabled ${skill.enabled ? "is-enabled" : ""}`}>
                    {skill.enabled ? "已启用" : "已停用"}
                  </span>
                  <button
                    type="button"
                    className={`skill-toggle ${skill.enabled ? "is-on" : ""}`}
                    aria-label={`${skill.enabled ? "停用" : "启用"} ${skillName(skill)}`}
                    aria-pressed={skill.enabled}
                    onClick={() =>
                      enable.mutate({ installationId: skill.id, enabled: !skill.enabled })
                    }
                    disabled={skill.packageState !== "installed" || approvalRequired}
                  >
                    <span />
                  </button>
                </div>
              </header>
              <details className="skill-technical-details">
                <summary>权限与详情</summary>
                <dl className="skill-metadata">
                  <div>
                    <dt>范围</dt>
                    <dd>
                      {skill.scope === "builtin"
                        ? "内置"
                        : skill.scope === "personal"
                          ? "个人"
                          : "工作区"}
                      {skill.workspaceId ? ` · ${skill.workspaceId}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>版本</dt>
                    <dd>{skill.version}</dd>
                  </div>
                  <div>
                    <dt>发布者</dt>
                    <dd>{skill.publisher}</dd>
                  </div>
                  <div>
                    <dt>来源</dt>
                    <dd>
                      {skillSourceKindLabel(skill.sourceKind)} · {skillSourceLabel(skill)}
                    </dd>
                  </div>
                  <div>
                    <dt>平台</dt>
                    <dd>{skill.platforms.map(skillPlatformLabel).join(" / ")}</dd>
                  </div>
                  <div>
                    <dt>校验</dt>
                    <dd>
                      <code>{skill.checksumSha256.slice(0, 16)}…</code>
                    </dd>
                  </div>
                </dl>
                <section className="skill-dependencies">
                  <strong>依赖与权限</strong>
                  <p>
                    工具：{skill.declaredTools.map(skillToolLabel).join("、") || "无"} · MCP：
                    {skill.declaredMcpServers.join("、") || "无"}
                  </p>
                  {skill.permissions.length === 0 ? (
                    <span>不声明额外权限</span>
                  ) : (
                    skill.permissions.map((permission) => (
                      <span key={`${permission.capability}-${permission.actions.join("-")}`}>
                        {skillCapabilityLabel(permission.capability)} ·{" "}
                        {permission.actions.map(skillActionLabel).join("/")} ·{" "}
                        {permission.targets.join("、") || "当前授权范围"} —{" "}
                        {skillReasonLabel(permission.reason)}
                      </span>
                    ))
                  )}
                </section>
              </details>
              <div className="skill-card-actions">
                {approvalRequired ? (
                  <button type="button" onClick={() => approve.mutate(skill)}>
                    审核并批准权限
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    autoInvoke.mutate({ installationId: skill.id, value: !skill.autoInvoke })
                  }
                  disabled={!skill.enabled}
                >
                  自动触发：{skill.autoInvoke ? "开" : "关"}
                </button>
                {skill.scope !== "builtin" ? (
                  <button type="button" onClick={() => update.mutate(skill.id)}>
                    更新
                  </button>
                ) : null}
                {skill.rollbackVersions.length > 0 ? (
                  <select
                    aria-label={`回滚 ${skillName(skill)}`}
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value)
                        rollback.mutate({
                          installationId: skill.id,
                          version: event.target.value,
                        });
                      event.target.value = "";
                    }}
                  >
                    <option value="">回滚版本…</option>
                    {skill.rollbackVersions.map((version) => (
                      <option value={version} key={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                ) : null}
                {skill.permissions.length > 0 ? (
                  <button type="button" onClick={() => setResetTarget(skill)}>
                    撤销已批准权限…
                  </button>
                ) : null}
                {skill.scope !== "builtin" ? (
                  <button
                    type="button"
                    className="danger-action"
                    onClick={() => {
                      if (window.confirm(`卸载 ${skillName(skill)}？本地包会移入可恢复回收目录。`))
                        uninstall.mutate(skill.id);
                    }}
                  >
                    卸载
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      {resetTarget ? (
        <ConfirmDialog
          title={`撤销 ${skillName(resetTarget)} 的权限并停用？`}
          description="这不是恢复默认设置。已批准权限会被撤销，Skill 会立即停用；之后必须重新审核并批准权限才能启用。"
          confirmLabel="撤销权限并停用"
          pending={reset.isPending}
          onCancel={() => setResetTarget(null)}
          onConfirm={() => reset.mutate(resetTarget.id)}
        />
      ) : null}
    </section>
  );
}

function ThemeSettings({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}): React.JSX.Element {
  return (
    <section className="settings-card settings-stack theme-settings" aria-label="外观主题">
      <div className="settings-heading">
        <div>
          <h2>外观</h2>
          <p>选择工作区主题，修改会立即生效。</p>
        </div>
      </div>
      <div className="theme-options" role="radiogroup" aria-label="主题">
        {themeOptions.map(({ value: option, label, description, icon: Icon }) => {
          const selected = value === option;
          return (
            <label key={option} className={`theme-option ${selected ? "is-selected" : ""}`}>
              <input
                type="radio"
                name="workspace-theme"
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
              />
              <span className={`theme-preview theme-preview-${option}`} aria-hidden="true">
                <Icon size={19} weight={selected ? "fill" : "regular"} />
              </span>
              <span className="theme-option-copy">
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              {selected ? <CheckCircle size={17} weight="fill" aria-hidden="true" /> : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}

function ModelSettings({
  value,
  onChange,
}: {
  value: string;
  onChange: (modelRef: string) => void;
}): React.JSX.Element {
  const models = useQuery({
    queryKey: ["models", "catalog"],
    queryFn: () => window.openerx.listModels(),
    retry: false,
  });
  const availableModels = (models.data ?? []).filter(({ status }) => status === "available");
  const visibleModels = availableModels.length > 0 ? availableModels : (models.data ?? []);
  const effectiveValue = visibleModels.some(({ modelRef }) => modelRef === value)
    ? value
    : (visibleModels.find(({ modelRef }) => modelRef === automaticModelRef)?.modelRef ??
      visibleModels[0]?.modelRef ??
      value);

  return (
    <section className="settings-card settings-stack" aria-label="默认模型">
      <div className="settings-heading">
        <div>
          <h2>默认模型</h2>
          <p>用于之后创建的新任务；已有对话继续使用各自选择的模型。</p>
        </div>
      </div>
      <label htmlFor="default-model-setting">新任务默认模型</label>
      <select
        id="default-model-setting"
        value={effectiveValue}
        disabled={models.isPending || visibleModels.length === 0 || availableModels.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {visibleModels.map((model) => (
          <option key={model.modelRef} value={model.modelRef}>
            {model.displayName} · {model.priceSummary}
            {model.status === "unavailable" ? " · 需要配置 API" : ""}
          </option>
        ))}
      </select>
      {models.error ? (
        <p className="inline-error">{userFacingError(models.error, "模型目录暂时不可用。")}</p>
      ) : null}
    </section>
  );
}

function ModelServiceSettingsPanel(): React.JSX.Element {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["model-service", "settings"],
    queryFn: () => window.openerx.getModelServiceSettings(),
    retry: false,
  });
  const [draft, setDraft] = useState<ModelServiceSettingsUpdate>({
    mode: "byok",
    byok: defaultByokModelConfiguration(),
  });
  const [providerKeys, setProviderKeys] = useState<Partial<Record<ByokProviderId, string>>>({});
  const [testModelIds, setTestModelIds] = useState<Record<ByokProviderId, string>>(() =>
    byokProviderPresets.reduce(
      (result, provider) => ({ ...result, [provider.id]: provider.models[0]?.id ?? "" }),
      {} as Record<ByokProviderId, string>,
    ),
  );
  const [providerTestFeedback, setProviderTestFeedback] = useState<
    Partial<Record<ByokProviderId, { status: "testing" | "success" | "error"; message: string }>>
  >({});
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!settings.data) return;
    setDraft((current) => ({
      mode: settings.data.mode,
      byok: settings.data.byok ?? current.byok,
    }));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => {
      const providerApiKeys = Object.fromEntries(
        Object.entries(providerKeys)
          .map(([providerId, apiKey]) => [providerId, apiKey?.trim()] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
      ) as Partial<Record<ByokProviderId, string>>;
      return window.openerx.updateModelServiceSettings({
        ...draft,
        ...(Object.keys(providerApiKeys).length > 0 ? { providerApiKeys } : {}),
      });
    },
    onSuccess: async (value) => {
      queryClient.setQueryData(["model-service", "settings"], value);
      await queryClient.invalidateQueries({ queryKey: ["models", "catalog"] });
      setDraft((current) => ({ ...current, apiKey: undefined }));
      setProviderKeys({});
      const configuredProviders = Object.values(value.providerCredentials).filter(Boolean).length;
      setNotice(
        value.mode === "byok"
          ? `模型 API 已保存 · 已配置 ${configuredProviders} 个厂商，可在任务中直接切换。`
          : "已切换到托管服务模式。",
      );
    },
  });
  const test = useMutation({
    mutationFn: ({
      providerId,
      configuration,
    }: {
      providerId: ByokProviderId;
      configuration: NonNullable<ModelServiceSettingsUpdate["byok"]>;
    }) =>
      window.openerx.testByokConnection({
        mode: "byok",
        byok: configuration,
        ...(providerKeys[providerId]?.trim()
          ? { providerApiKeys: { [providerId]: providerKeys[providerId].trim() } }
          : {}),
      }),
    onMutate: ({ providerId }) => {
      const providerName =
        byokProviderPresets.find(({ id }) => id === providerId)?.label ?? providerId;
      setProviderTestFeedback((current) => ({
        ...current,
        [providerId]: { status: "testing", message: `${providerName} 正在测试连接…` },
      }));
    },
    onSuccess: (value, { providerId }) => {
      setProviderTestFeedback((current) => ({
        ...current,
        [providerId]: {
          status: "success",
          message: `连接成功 · ${value.latencyMs} ms${value.reportedModel ? ` · ${value.reportedModel}` : ""}`,
        },
      }));
    },
    onError: (error, { providerId }) => {
      setProviderTestFeedback((current) => ({
        ...current,
        [providerId]: {
          status: "error",
          message: userFacingError(error, "连接失败，请检查 API Key、网络和模型可用性。"),
        },
      }));
    },
  });
  const clearKey = useMutation({
    mutationFn: (providerId?: ByokProviderId) => window.openerx.clearByokApiKey(providerId),
    onSuccess: (value, providerId) => {
      queryClient.setQueryData(["model-service", "settings"], value);
      if (providerId) {
        setProviderKeys((current) => ({ ...current, [providerId]: "" }));
      } else {
        setDraft((current) => ({ ...current, mode: value.mode, apiKey: undefined }));
      }
      const providerName = byokProviderPresets.find(({ id }) => id === providerId)?.label;
      setNotice(`${providerName ?? "自定义接口"} API Key 已删除。`);
    },
  });
  const byok = draft.byok;
  const patchByok = (patch: Partial<NonNullable<ModelServiceSettingsUpdate["byok"]>>): void => {
    if (byok) setDraft({ ...draft, byok: { ...byok, ...patch } });
  };
  return (
    <section className="settings-card settings-stack" aria-label="模型服务模式">
      <div className="settings-heading">
        <div>
          <h2>模型服务</h2>
          <p>各厂商地址和模型均已预置。可同时保存多个 Key，请求从本机直连对应厂商。</p>
        </div>
      </div>
      <label htmlFor="model-service-mode">运行模式</label>
      <select
        id="model-service-mode"
        value={draft.mode}
        onChange={(event) => setDraft({ ...draft, mode: event.target.value as "hosted" | "byok" })}
      >
        <option value="byok">单安装包 / BYOK（默认）</option>
        <option value="hosted">托管服务（需要部署服务端）</option>
      </select>
      {draft.mode === "byok" && byok ? (
        <>
          <fieldset className="model-provider-grid">
            <legend className="visually-hidden">国内模型厂商</legend>
            {byokProviderPresets.map((provider) => {
              const selectedModel =
                provider.models.find(({ id }) => id === testModelIds[provider.id]) ??
                provider.models[0];
              const configured = settings.data?.providerCredentials[provider.id] === true;
              const hasDraftKey = Boolean(providerKeys[provider.id]?.trim());
              const testFeedback = providerTestFeedback[provider.id];
              return (
                <article
                  className="model-provider-card"
                  key={provider.id}
                  aria-label={`${provider.label} 配置`}
                >
                  <div className="model-provider-heading">
                    <div>
                      <h3>{provider.label}</h3>
                      <small>{provider.models.length} 个预置模型</small>
                    </div>
                    <span className={configured ? "is-configured" : undefined}>
                      {configured ? "已配置" : "未配置"}
                    </span>
                  </div>
                  <label htmlFor={`provider-key-${provider.id}`}>{provider.label} API Key</label>
                  <input
                    id={`provider-key-${provider.id}`}
                    type="password"
                    autoComplete="off"
                    value={providerKeys[provider.id] ?? ""}
                    placeholder={
                      configured ? "已安全保存；留空表示不更改" : provider.apiKeyPlaceholder
                    }
                    onChange={(event) => {
                      setProviderKeys((current) => ({
                        ...current,
                        [provider.id]: event.target.value,
                      }));
                      setProviderTestFeedback((feedback) => {
                        const next = { ...feedback };
                        delete next[provider.id];
                        return next;
                      });
                    }}
                  />
                  <label htmlFor={`provider-model-${provider.id}`}>连接测试模型</label>
                  <select
                    id={`provider-model-${provider.id}`}
                    value={selectedModel?.id ?? ""}
                    onChange={(event) =>
                      setTestModelIds((current) => ({
                        ...current,
                        [provider.id]: event.target.value,
                      }))
                    }
                  >
                    {provider.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  {selectedModel ? (
                    <p className="model-provider-meta">
                      {selectedModel.configuration.contextWindow.toLocaleString()} Token 上下文 ·
                      {selectedModel.configuration.capabilities.imageInput ? " 图片" : " 文本"} ·
                      {selectedModel.configuration.capabilities.functionCalling
                        ? " 工具调用"
                        : " 无工具调用"}
                    </p>
                  ) : null}
                  <div className="toolbar-actions">
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedModel) return;
                        if (!configured && !hasDraftKey) {
                          setProviderTestFeedback((current) => ({
                            ...current,
                            [provider.id]: {
                              status: "error",
                              message: `请先填写 ${provider.label} API Key。`,
                            },
                          }));
                          return;
                        }
                        test.mutate({
                          providerId: provider.id,
                          configuration: selectedModel.configuration,
                        });
                      }}
                      disabled={test.isPending || !selectedModel}
                    >
                      {testFeedback?.status === "testing" ? "测试中…" : "测试连接"}
                    </button>
                    {configured ? (
                      <button
                        type="button"
                        onClick={() => clearKey.mutate(provider.id)}
                        disabled={clearKey.isPending}
                      >
                        删除 Key
                      </button>
                    ) : null}
                  </div>
                  {testFeedback ? (
                    <p
                      className={`model-provider-feedback ${
                        testFeedback.status === "error" ? "inline-error" : "inline-success"
                      }`}
                      role={testFeedback.status === "error" ? "alert" : "status"}
                    >
                      {testFeedback.message}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </fieldset>
          <div className="toolbar-actions model-provider-save">
            <button
              type="button"
              className="primary-action"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              保存全部并启用
            </button>
          </div>
          <details className="settings-disclosure model-custom-provider">
            <summary>
              自定义 OpenAI-compatible 接口
              <small>仅在使用其他厂商或私有网关时需要</small>
            </summary>
            <div className="settings-card settings-stack">
              <label htmlFor="byok-base-url">Base URL</label>
              <input
                id="byok-base-url"
                type="url"
                value={byok.baseUrl}
                onChange={(event) => patchByok({ baseUrl: event.target.value })}
              />
              <label htmlFor="byok-api-key">API Key</label>
              <input
                id="byok-api-key"
                type="password"
                value={draft.apiKey ?? ""}
                placeholder={
                  settings.data?.credentialConfigured
                    ? "已安全保存；留空表示不更改"
                    : "输入 API Key"
                }
                onChange={(event) =>
                  setDraft({ ...draft, apiKey: event.target.value || undefined })
                }
              />
              <label htmlFor="byok-model-id">模型 ID</label>
              <input
                id="byok-model-id"
                value={byok.modelId}
                onChange={(event) =>
                  patchByok({ modelId: event.target.value, displayName: event.target.value })
                }
              />
              <label htmlFor="byok-context-window">上下文窗口</label>
              <input
                id="byok-context-window"
                type="number"
                min="1024"
                value={byok.contextWindow}
                onChange={(event) => patchByok({ contextWindow: Number(event.target.value) })}
              />
              <label htmlFor="byok-max-output">最大输出 Token</label>
              <input
                id="byok-max-output"
                type="number"
                min="1"
                value={byok.maxOutputTokens}
                onChange={(event) => patchByok({ maxOutputTokens: Number(event.target.value) })}
              />
              <label>
                <input
                  type="checkbox"
                  checked={byok.capabilities.imageInput}
                  onChange={(event) =>
                    patchByok({
                      capabilities: { ...byok.capabilities, imageInput: event.target.checked },
                    })
                  }
                />
                支持图片输入
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={byok.capabilities.functionCalling}
                  onChange={(event) =>
                    patchByok({
                      capabilities: {
                        ...byok.capabilities,
                        functionCalling: event.target.checked,
                      },
                    })
                  }
                />
                支持工具调用
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={byok.capabilities.reasoning}
                  onChange={(event) =>
                    patchByok({
                      capabilities: { ...byok.capabilities, reasoning: event.target.checked },
                    })
                  }
                />
                支持推理
              </label>
              {settings.data?.credentialConfigured ? (
                <div className="toolbar-actions">
                  <button
                    type="button"
                    onClick={() => clearKey.mutate(undefined)}
                    disabled={clearKey.isPending}
                  >
                    删除自定义 Key
                  </button>
                </div>
              ) : null}
            </div>
          </details>
        </>
      ) : (
        <button
          type="button"
          className="primary-action"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          保存模式
        </button>
      )}
      {notice ? <p className="inline-success">{notice}</p> : null}
      {settings.error || save.error || clearKey.error ? (
        <p className="inline-error">
          {userFacingError(settings.error ?? save.error ?? clearKey.error, "模型服务配置失败。")}
        </p>
      ) : null}
    </section>
  );
}

const performanceLabels = {
  desktop_interactive: "桌面可交互",
  app_service_ready: "本地服务就绪",
  idle_rss: "当前进程内存",
} as const;

const performanceUnitLabels = {
  ms: "毫秒",
  mib: "MiB",
} as const;

const performanceStatusLabels = {
  pass: "达标",
  over_budget: "超出预算",
  pending: "等待数据",
} as const;

const releaseUpdateStatusLabels: Record<ReleaseUpdateState["status"], string> = {
  disabled: "开发包未启用更新",
  idle: "可以检查更新",
  checking: "正在验证更新清单",
  available: "发现新版本",
  downloading: "正在下载更新",
  downloaded: "更新已下载",
  up_to_date: "已是最新版本",
  error: "更新检查失败",
};

function ReleaseUpdateSettings(): React.JSX.Element {
  const queryClient = useQueryClient();
  const update = useQuery({
    queryKey: ["release", "update"],
    queryFn: () => window.openerx.getReleaseUpdateState(),
    retry: false,
  });
  useEffect(
    () =>
      window.openerx.onReleaseUpdateState((state) => {
        queryClient.setQueryData(["release", "update"], state);
      }),
    [queryClient],
  );
  const check = useMutation({
    mutationFn: () => window.openerx.checkForReleaseUpdate(),
    onSuccess: (state) => queryClient.setQueryData(["release", "update"], state),
  });
  const install = useMutation({
    mutationFn: () => window.openerx.installReleaseUpdate(),
    onSuccess: (state) => queryClient.setQueryData(["release", "update"], state),
  });
  const state = update.data;
  return (
    <section className="settings-card settings-stack release-update-settings" aria-label="应用更新">
      <div className="settings-heading">
        <div>
          <h2>应用更新</h2>
          <p>仅接受与当前平台、架构和发布通道匹配的 Ed25519 签名更新清单。</p>
        </div>
        <span className={`release-status status-${state?.status ?? "checking"}`}>
          {state ? releaseUpdateStatusLabels[state.status] : "正在读取"}
        </span>
      </div>
      <div className="release-update-summary">
        <span>当前版本 {state?.currentVersion ?? "—"}</span>
        <span>通道 {state?.channel ?? "—"}</span>
        {state?.availableVersion ? <strong>可用版本 {state.availableVersion}</strong> : null}
        {state?.progressPercentage !== null && state?.progressPercentage !== undefined ? (
          <span>下载 {state.progressPercentage.toFixed(1)}%</span>
        ) : null}
      </div>
      <div className="settings-actions">
        <button
          type="button"
          onClick={() => check.mutate()}
          disabled={
            !state ||
            state.status === "disabled" ||
            state.status === "checking" ||
            state.status === "downloading" ||
            check.isPending
          }
        >
          <ArrowClockwise size={16} /> 检查更新
        </button>
        {state?.status === "downloaded" ? (
          <button type="button" onClick={() => install.mutate()} disabled={install.isPending}>
            安装并重启
          </button>
        ) : null}
      </div>
      {state?.status === "disabled" ? (
        <p className="settings-note">正式签名包才会内置更新公钥和 HTTPS Manifest 地址。</p>
      ) : null}
      {state?.reason && state.status === "error" ? (
        <p className="inline-error">更新错误：{state.reason}</p>
      ) : null}
    </section>
  );
}

function DiagnosticsSettings(): React.JSX.Element {
  const diagnostics = useQuery({
    queryKey: ["diagnostics", "preview"],
    queryFn: () => window.openerx.getDiagnosticsPreview(),
    retry: false,
  });
  const personalData = useQuery({
    queryKey: ["personal-data", "summary"],
    queryFn: () => window.openerx.getPersonalDataSummary(),
    retry: false,
  });
  const exportDiagnostics = useMutation({
    mutationFn: () => window.openerx.exportDiagnostics(),
  });
  const exportPersonalData = useMutation({
    mutationFn: () => window.openerx.exportPersonalData(),
  });
  const preview = diagnostics.data;
  const summary = personalData.data;

  return (
    <section
      className="settings-card settings-stack diagnostics-settings"
      aria-label="诊断与数据导出"
    >
      <div className="settings-heading">
        <div>
          <h2>诊断与数据</h2>
          <p>先预览脱敏范围，再决定是否保存；个人内容使用独立导出。</p>
        </div>
        <span className={`diagnostic-health health-${preview?.health ?? "collecting"}`}>
          {preview?.health === "ready"
            ? "状态良好"
            : preview?.health === "attention"
              ? "需要关注"
              : "正在收集"}
        </span>
      </div>
      <section className="diagnostic-metrics" aria-label="性能预算">
        {(preview?.performance ?? []).map((metric) => (
          <article key={metric.name} className={`metric-${metric.status}`}>
            <span>{performanceLabels[metric.name]}</span>
            <strong>
              {metric.value.toLocaleString()} {performanceUnitLabels[metric.unit]}
            </strong>
            <small>
              预算 ≤ {metric.budget.toLocaleString()} {performanceUnitLabels[metric.unit]} ·{" "}
              {performanceStatusLabels[metric.status]}
            </small>
          </article>
        ))}
      </section>
      {preview ? (
        <div className="diagnostic-preview">
          <div>
            <strong>诊断包包含</strong>
            {preview.includes.map((item) => (
              <span key={item}>✓ {item}</span>
            ))}
          </div>
          <div>
            <strong>始终排除</strong>
            {preview.excludes.map((item) => (
              <span key={item}>— {item}</span>
            ))}
          </div>
        </div>
      ) : null}
      <p className="settings-note">
        已记录 {preview?.eventCount ?? 0} 条脱敏事件 · {preview?.restartCount ?? 0} 次服务重启 ·{" "}
        {preview?.errorCount ?? 0} 个错误
      </p>
      <section className="personal-data-summary" aria-label="本机个人数据摘要">
        <div>
          <strong>本机个人数据</strong>
          <span>
            {summary?.conversations ?? 0} 个对话 · {summary?.messages ?? 0} 条消息 ·{" "}
            {summary?.files ?? 0} 个文件 · {summary?.artifacts ?? 0} 个成果 ·{" "}
            {summary?.memories ?? 0} 条记忆
          </span>
          <small>Token、报价、费用和账单只读取服务端记录，不写入此本地导出。</small>
        </div>
      </section>
      <div className="settings-actions">
        <button
          type="button"
          onClick={() => exportDiagnostics.mutate()}
          disabled={!preview || exportDiagnostics.isPending}
        >
          <DownloadSimple size={16} /> 导出脱敏诊断包
        </button>
        <button
          type="button"
          onClick={() => exportPersonalData.mutate()}
          disabled={!summary || exportPersonalData.isPending}
        >
          <DownloadSimple size={16} /> 导出个人数据
        </button>
      </div>
      {exportDiagnostics.data ? <p>诊断包已保存：{exportDiagnostics.data.fileName}</p> : null}
      {exportPersonalData.data ? <p>个人数据已保存：{exportPersonalData.data.fileName}</p> : null}
      {diagnostics.error ||
      personalData.error ||
      exportDiagnostics.error ||
      exportPersonalData.error ? (
        <p className="inline-error">
          {
            (
              diagnostics.error ??
              personalData.error ??
              exportDiagnostics.error ??
              exportPersonalData.error
            )?.message
          }
        </p>
      ) : null}
    </section>
  );
}

function RemoteSettings(): React.JSX.Element {
  const queryClient = useQueryClient();
  const remote = useQuery({
    queryKey: ["remote", "state"],
    queryFn: () => window.openerx.getRemoteState(),
    retry: false,
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const enable = useMutation({
    mutationFn: (enabled: boolean) => window.openerx.setRemoteEnabled({ enabled }),
    onSuccess: (state) => {
      queryClient.setQueryData(["remote", "state"], state);
      if (!state.enabled) setQrDataUrl(null);
    },
  });
  const challenge = useMutation({
    mutationFn: () => window.openerx.createRemotePairingChallenge(),
  });
  const revoke = useMutation({
    mutationFn: (pairingId: string) => window.openerx.revokeRemotePairing({ pairingId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["remote", "state"] }),
  });

  useEffect(() => {
    const value = challenge.data;
    if (!value) return;
    const pairingUrl = `openerx://remote/pair?payload=${encodeURIComponent(JSON.stringify(value))}`;
    let active = true;
    void QRCode.toDataURL(pairingUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#232823", light: "#ffffff" },
    }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl);
    });
    return () => {
      active = false;
    };
  }, [challenge.data]);

  const state = remote.data;
  const activePairings = state?.pairings.filter(({ status }) => status === "active") ?? [];
  return (
    <section className="settings-card settings-stack remote-settings" aria-label="手机远程控制">
      <div className="settings-heading">
        <div>
          <h2>手机远程控制</h2>
          <p>手机是控制面；Pi、文件、工具和权限判断仍只在这台电脑运行。</p>
        </div>
        <button
          type="button"
          className={state?.enabled ? "danger-action" : "primary-action"}
          disabled={enable.isPending || remote.isPending || state?.available === false}
          onClick={() => enable.mutate(!state?.enabled)}
        >
          {state?.enabled ? "关闭 Remote" : "开启 Remote"}
        </button>
      </div>
      {state?.enabled ? (
        <div className="remote-status-row">
          <span className={`remote-presence presence-${state.host?.presence ?? "offline"}`}>
            {state.host?.presence ?? "offline"}
          </span>
          <span>{state.host?.displayName}</span>
          <span>{activePairings.length} 台手机已配对</span>
          <button type="button" onClick={() => challenge.mutate()} disabled={challenge.isPending}>
            <QrCode size={16} /> 新建配对码
          </button>
        </div>
      ) : null}
      {challenge.data && qrDataUrl ? (
        <div className="remote-pairing-panel">
          <img src={qrDataUrl} alt={`${desktopBrand.productName} Remote 一次性配对二维码`} />
          <div>
            <strong>用已登录同一账户的手机扫描</strong>
            <p>二维码不含访问令牌，只含一次性挑战、公钥和到期时间。</p>
            <span>到期：{new Date(challenge.data.expiresAt).toLocaleString()}</span>
            <code>{challenge.data.challengeId}</code>
          </div>
        </div>
      ) : null}
      {activePairings.map((pairing) => (
        <div className="device-card" key={pairing.pairingId}>
          <div>
            <strong>
              <DeviceMobile size={16} /> 控制设备 {pairing.controllerDeviceId.slice(0, 8)}
            </strong>
            <span>创建于 {new Date(pairing.createdAt).toLocaleString()}</span>
            <span>到期于 {new Date(pairing.expiresAt).toLocaleString()}</span>
          </div>
          <button
            type="button"
            onClick={() => revoke.mutate(pairing.pairingId)}
            disabled={revoke.isPending}
          >
            撤销配对
          </button>
        </div>
      ))}
      {remote.error || enable.error || challenge.error || revoke.error || state?.reason ? (
        <p className="inline-error">
          {(remote.error ?? enable.error ?? challenge.error ?? revoke.error)?.message ??
            state?.reason}
        </p>
      ) : null}
    </section>
  );
}

const memoryKindLabels: Record<MemoryKind, string> = {
  profile: "个人资料",
  preference: "偏好",
  workflow: "工作方式",
  ongoing_context: "持续上下文",
};

function MemorySourceDetails({ memory }: { memory: MemoryEntry }): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const sources = useQuery({
    queryKey: ["memory", memory.id, "sources"],
    queryFn: () => window.openerx.listMemorySources({ memoryId: memory.id }),
    enabled: expanded,
    retry: false,
  });
  if (!memory.sourceConversationId) return null;
  return (
    <div className="memory-source-details">
      <button
        type="button"
        className="memory-source-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "收起来源" : "查看来源"}
      </button>
      {expanded ? (
        sources.isPending ? (
          <small>正在读取来源…</small>
        ) : sources.error ? (
          <small>来源读取失败：{sources.error.message}</small>
        ) : sources.data?.length === 0 ? (
          <small>暂无可用来源。</small>
        ) : (
          <ul className="memory-source-list">
            {(sources.data ?? []).map((source) => (
              <li key={source.conversationId}>
                <button
                  type="button"
                  disabled={source.conversationDeletedAt !== null}
                  onClick={() => navigate(`/chat/${source.conversationId}`)}
                >
                  {source.conversationTitle ?? `对话 ${source.conversationId.slice(0, 8)}`}
                </button>
                <small>
                  {source.origin === "explicit"
                    ? "显式保存"
                    : source.origin === "automatic"
                      ? "自动抽取"
                      : "合并来源"}
                  {source.conversationDeletedAt ? " · 对话已删除" : ""}
                  {` · ${new Date(source.createdAt).toLocaleString()}`}
                </small>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function MemorySettingsPanel(): React.JSX.Element {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [kind, setKind] = useState<MemoryKind>("preference");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [filterKind, setFilterKind] = useState<MemoryKind | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const settings = useQuery({
    queryKey: ["memory", "settings"],
    queryFn: () => window.openerx.getMemorySettings(),
    retry: false,
  });
  const memories = useQuery({
    queryKey: ["memory", "list", query.trim(), filterKind],
    queryFn: () =>
      window.openerx.listMemories({
        status: "active",
        limit: 100,
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(filterKind === "all" ? {} : { kind: filterKind }),
      }),
    retry: false,
  });
  const mergeReviews = useQuery({
    queryKey: ["memory", "merge-reviews", "pending"],
    queryFn: () => window.openerx.listMemoryMergeReviews({ status: "pending", limit: 50 }),
    enabled: settings.data?.memoriesEnabled === true,
    retry: false,
  });
  const updateSettings = useMutation({
    mutationFn: window.openerx.updateMemorySettings,
    onSuccess: (next) => queryClient.setQueryData(["memory", "settings"], next),
  });
  const saveMemory = useMutation({
    mutationFn: () =>
      window.openerx.upsertMemory({
        ...(editingId ? { id: editingId } : {}),
        kind,
        content: content.trim(),
        idempotencyKey: `memory-ui:${crypto.randomUUID()}`,
      }),
    onSuccess: async () => {
      setContent("");
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["memory", "list"] });
    },
  });
  const deleteMemory = useMutation({
    mutationFn: (memoryId: string) =>
      window.openerx.deleteMemory({
        memoryId,
        idempotencyKey: `memory-ui-delete:${crypto.randomUUID()}`,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["memory", "list"] });
    },
  });
  const resolveMergeReview = useMutation({
    mutationFn: (input: { reviewId: string; resolution: "accept" | "dismiss" }) =>
      window.openerx.resolveMemoryMergeReview({
        ...input,
        idempotencyKey: `memory-merge-review:${crypto.randomUUID()}`,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memory", "merge-reviews"] }),
        queryClient.invalidateQueries({ queryKey: ["memory", "list"] }),
      ]);
    },
  });
  const clearMemories = useMutation({
    mutationFn: async () => {
      const scope =
        filterKind === "all" ? "全部长期记忆" : `全部“${memoryKindLabels[filterKind]}”记忆`;
      if (!window.confirm(`删除${scope}？若已开启同步，此操作也会同步到其他设备。`)) {
        return null;
      }
      return await window.openerx.clearMemories({
        ...(filterKind === "all" ? {} : { kind: filterKind }),
        idempotencyKey: `memory-ui-clear:${crypto.randomUUID()}`,
      });
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: ["memory", "list"] });
    },
  });
  const state = settings.data;
  const focusedMemoryId = new URLSearchParams(location.search).get("memory");
  useEffect(() => {
    if (!focusedMemoryId || !memories.data?.some(({ id }) => id === focusedMemoryId)) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`memory-${focusedMemoryId}`)?.focus({ preventScroll: false });
    });
  }, [focusedMemoryId, memories.data]);
  const error =
    settings.error ??
    memories.error ??
    mergeReviews.error ??
    updateSettings.error ??
    saveMemory.error ??
    deleteMemory.error ??
    resolveMergeReview.error ??
    clearMemories.error;
  return (
    <section className="settings-card settings-stack memory-settings" aria-label="长期记忆">
      <div className="settings-heading">
        <div>
          <h2>长期记忆</h2>
          <p>跨对话保存你明确要求记住的资料、偏好和工作方式。</p>
        </div>
        <Brain size={23} />
      </div>
      {settings.isPending ? <p>正在读取记忆设置…</p> : null}
      {state ? (
        <div className="memory-toggle-list">
          <label>
            <span>
              <strong>启用长期记忆</strong>
              <small>默认开启；关闭后不会召回，也不会提供记忆工具。</small>
            </span>
            <input
              type="checkbox"
              checked={state.memoriesEnabled}
              disabled={updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({
                  memoriesEnabled: event.target.checked,
                  ...(event.target.checked && !state.useMemories ? { useMemories: true } : {}),
                })
              }
            />
          </label>
          <label>
            <span>
              <strong>用于回答</strong>
              <small>每轮最多召回 8 条；当前消息始终优先。</small>
            </span>
            <input
              type="checkbox"
              checked={state.useMemories}
              disabled={!state.memoriesEnabled || updateSettings.isPending}
              onChange={(event) => updateSettings.mutate({ useMemories: event.target.checked })}
            />
          </label>
          <label>
            <span>
              <strong>跨设备同步</strong>
              <small>登录后随账户同步；未登录时只保存在本机。</small>
            </span>
            <input
              type="checkbox"
              checked={state.syncMemories}
              disabled={!state.memoriesEnabled || updateSettings.isPending}
              onChange={(event) => updateSettings.mutate({ syncMemories: event.target.checked })}
            />
          </label>
          <label>
            <span>
              <strong>自动生成记忆</strong>
              <small>对话空闲后由服务器计费并抽取；新记忆会通知你且可立即撤销。</small>
            </span>
            <input
              type="checkbox"
              checked={state.generateMemories}
              disabled={!state.memoriesEnabled || updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({ generateMemories: event.target.checked })
              }
            />
          </label>
          <label>
            <span>
              <strong>排除外部上下文</strong>
              <small>默认跳过使用过 Web、MCP、文件或工具搜索的对话。</small>
            </span>
            <input
              type="checkbox"
              checked={state.disableOnExternalContext}
              disabled={!state.memoriesEnabled || updateSettings.isPending}
              onChange={(event) =>
                updateSettings.mutate({ disableOnExternalContext: event.target.checked })
              }
            />
          </label>
          <label>
            <span>
              <strong>空闲等待（分钟）</strong>
              <small>只有对话持续空闲且没有生成任务时，后台任务才有资格运行。</small>
            </span>
            <input
              type="number"
              min={1}
              max={1_440}
              value={state.idleDelayMinutes}
              disabled={!state.memoriesEnabled || updateSettings.isPending}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isInteger(value) && value >= 1 && value <= 1_440) {
                  updateSettings.mutate({ idleDelayMinutes: value });
                }
              }}
            />
          </label>
        </div>
      ) : null}
      {state?.memoriesEnabled ? (
        <search className="memory-filters" aria-label="搜索和筛选记忆">
          <label htmlFor="memory-search">搜索记忆</label>
          <div>
            <MagnifyingGlass size={15} aria-hidden="true" />
            <input
              id="memory-search"
              type="search"
              value={query}
              placeholder="搜索内容或检索词"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <label htmlFor="memory-filter-kind">筛选类型</label>
          <select
            id="memory-filter-kind"
            value={filterKind}
            onChange={(event) => setFilterKind(event.target.value as MemoryKind | "all")}
          >
            <option value="all">全部类型</option>
            {Object.entries(memoryKindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </search>
      ) : null}
      {state?.memoriesEnabled ? (
        <section className="memory-merge-reviews" aria-label="待确认的记忆合并建议">
          <div className="memory-review-heading">
            <div>
              <h3>待确认的记忆建议</h3>
              <p>模型发现语义相近或可能冲突的内容；确认前不会修改已保存记忆。</p>
            </div>
            <span>{mergeReviews.data?.length ?? 0}</span>
          </div>
          {(mergeReviews.data ?? []).map((review) => (
            <article key={review.id} className="memory-review-row">
              <div>
                <span>
                  {memoryKindLabels[review.kind]} ·{" "}
                  {review.relation === "duplicate" ? "可能重复" : "可能冲突"}
                </span>
                <small>现有记忆</small>
                <p>{review.targetContent}</p>
                <small>
                  {review.proposalMemoryId
                    ? review.relation === "duplicate"
                      ? "另一条已有记忆（确认后合并）"
                      : "较新的已有记忆（确认后替代）"
                    : review.relation === "duplicate"
                      ? "新发现的合并来源"
                      : "建议替代为"}
                </small>
                <p>{review.proposedContent}</p>
              </div>
              <div className="memory-row-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={resolveMergeReview.isPending}
                  onClick={() =>
                    resolveMergeReview.mutate({ reviewId: review.id, resolution: "accept" })
                  }
                >
                  {review.relation === "duplicate" ? "确认合并" : "确认替代"}
                </button>
                <button
                  type="button"
                  disabled={resolveMergeReview.isPending}
                  onClick={() =>
                    resolveMergeReview.mutate({ reviewId: review.id, resolution: "dismiss" })
                  }
                >
                  忽略
                </button>
              </div>
            </article>
          ))}
          {!mergeReviews.isPending && (mergeReviews.data?.length ?? 0) === 0 ? (
            <p className="empty-hint">没有需要确认的建议。</p>
          ) : null}
        </section>
      ) : null}
      {state?.memoriesEnabled ? (
        <form
          className="memory-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (content.trim()) saveMemory.mutate();
          }}
        >
          <label htmlFor="memory-kind">类型</label>
          <select
            id="memory-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as MemoryKind)}
          >
            {Object.entries(memoryKindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor="memory-content">内容</label>
          <textarea
            id="memory-content"
            value={content}
            maxLength={2_000}
            placeholder="例如：回答我时优先给结论，再给必要细节。"
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="settings-actions">
            <button
              type="submit"
              className="primary-action"
              disabled={!content.trim() || saveMemory.isPending}
            >
              {editingId ? "保存修改" : "保存记忆"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setKind("preference");
                  setContent("");
                }}
              >
                取消编辑
              </button>
            ) : null}
            {(memories.data?.length ?? 0) > 0 ? (
              <button
                type="button"
                className="danger-action"
                disabled={clearMemories.isPending}
                onClick={() => clearMemories.mutate()}
              >
                {filterKind === "all" ? "删除全部" : "删除当前类别"}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
      <section className="memory-list" aria-label="已保存记忆">
        {(memories.data ?? []).map((memory) => (
          <article
            key={memory.id}
            id={`memory-${memory.id}`}
            className={`memory-row${focusedMemoryId === memory.id ? " is-highlighted" : ""}`}
            tabIndex={-1}
          >
            <div>
              <span>
                {memoryKindLabels[memory.kind]}
                {memory.origin === "automatic" ? " · 自动生成（可撤销）" : " · 显式保存"}
              </span>
              <p>{memory.content}</p>
              <small>更新于 {new Date(memory.updatedAt).toLocaleString()}</small>
              {memory.supersedesMemoryId ? (
                <small className="memory-supersede-note">
                  已替代上一版本；删除此条将恢复上一版本。
                </small>
              ) : null}
              <MemorySourceDetails memory={memory} />
            </div>
            <div className="memory-row-actions">
              <button
                type="button"
                className="secondary-action"
                aria-label={`编辑记忆：${memory.content}`}
                onClick={() => {
                  setEditingId(memory.id);
                  setKind(memory.kind);
                  setContent(memory.content);
                  document.getElementById("memory-content")?.focus();
                }}
              >
                编辑
              </button>
              <button
                type="button"
                aria-label={`${memory.supersedesMemoryId ? "撤销替代" : "删除记忆"}：${memory.content}`}
                disabled={deleteMemory.isPending}
                onClick={() => deleteMemory.mutate(memory.id)}
              >
                {memory.supersedesMemoryId ? "撤销替代" : "删除"}
              </button>
            </div>
          </article>
        ))}
        {!memories.isPending && (memories.data?.length ?? 0) === 0 ? (
          <p className="empty-hint">
            {query.trim() || filterKind !== "all"
              ? "没有符合当前搜索条件的记忆。"
              : "还没有已保存的长期记忆。"}
          </p>
        ) : null}
      </section>
      {error ? (
        <p className="inline-error">
          {error.message === "MEMORY_SENSITIVE_CONTENT_REJECTED"
            ? "该内容可能包含凭证或敏感标识，未保存为长期记忆。"
            : error.message}
        </p>
      ) : null}
      <p className="field-help">
        密钥、口令、验证码、Cookie、私钥、身份证/银行卡完整号码和本机绝对路径会被拒绝保存。
        记忆内容只作为可纠正的用户回忆，不作为系统指令。
      </p>
    </section>
  );
}

type AccountSettingsSection =
  | "account"
  | "billing"
  | "appearance"
  | "model"
  | "assistants"
  | "tools"
  | "memory"
  | "update"
  | "diagnostics";

const accountSettingsSectionLabels: Record<AccountSettingsSection, string> = {
  account: "账户",
  billing: "费用与账单",
  appearance: "外观",
  model: "模型",
  assistants: "skill",
  tools: "工具",
  memory: "记忆",
  update: "更新",
  diagnostics: "诊断与数据",
};

function requestedSettingsSection(search: string): AccountSettingsSection | null {
  const value = new URLSearchParams(search).get("section");
  return value === "account" ||
    value === "billing" ||
    value === "appearance" ||
    value === "model" ||
    value === "assistants" ||
    value === "tools" ||
    value === "memory" ||
    value === "update" ||
    value === "diagnostics"
    ? value
    : null;
}

function AccountSettings({
  themePreference,
  onThemeChange,
  defaultModelRef,
  onDefaultModelChange,
  onClose,
}: {
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  defaultModelRef: string;
  onDefaultModelChange: (modelRef: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const location = useLocation();
  const account = useQuery({
    queryKey: accountKey,
    queryFn: () => window.openerx.getAccountState(),
  });
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [activeSection, setActiveSection] = useState<AccountSettingsSection>(
    () => requestedSettingsSection(location.search) ?? "account",
  );
  const [settingsSearch, setSettingsSearch] = useState("");
  useEffect(() => {
    const requested = requestedSettingsSection(location.search);
    if (requested) setActiveSection(requested);
  }, [location.search]);
  const openSettingsSection = (section: AccountSettingsSection): void => {
    setActiveSection(section);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() =>
        document.getElementById(`${section}-section`)?.focus({ preventScroll: true }),
      );
    });
  };
  const normalizedSettingsSearch = settingsSearch.trim().toLocaleLowerCase();
  const settingsSectionMatches = (section: AccountSettingsSection): boolean =>
    !normalizedSettingsSearch ||
    accountSettingsSectionLabels[section].toLocaleLowerCase().includes(normalizedSettingsSearch);
  const renderSettingsNavButton = (
    section: AccountSettingsSection,
    icon: ReactNode,
  ): React.JSX.Element | null => {
    if (!settingsSectionMatches(section)) return null;
    const label = accountSettingsSectionLabels[section];
    return (
      <button
        type="button"
        className={activeSection === section ? "is-active" : ""}
        aria-current={activeSection === section ? "page" : undefined}
        onClick={() => openSettingsSection(section)}
      >
        {icon}
        <span>{label}</span>
      </button>
    );
  };
  const settingsSearchHasMatches = (
    Object.keys(accountSettingsSectionLabels) as AccountSettingsSection[]
  ).some(settingsSectionMatches);
  const signedIn = account.data?.status === "signed_in";
  const devices = useQuery({
    queryKey: ["account", "devices"],
    queryFn: () => window.openerx.listDevices(),
    enabled: signedIn,
    retry: false,
  });
  const sync = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => window.openerx.syncNow(),
    enabled: signedIn,
    retry: false,
  });
  const conflicts = useQuery({
    queryKey: ["sync", "conflicts"],
    queryFn: () => window.openerx.listSyncConflicts(),
    enabled: signedIn,
    retry: false,
  });
  useEffect(() => {
    if (!sync.data) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chat"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
    ]);
  }, [queryClient, sync.data]);
  const accountUsage = useQuery({
    queryKey: ["usage", "account"],
    queryFn: () => window.openerx.getUsage(),
    enabled: signedIn,
    retry: false,
  });
  useEffect(() => {
    if (!sync.data?.syncedAt) return;
    void queryClient.invalidateQueries({ queryKey: ["chat"] });
  }, [queryClient, sync.data?.syncedAt]);
  const requestCode = useMutation({
    mutationFn: () => window.openerx.requestEmailCode({ email }),
    onSuccess: (challenge) => setChallengeId(challenge.challengeId),
  });
  const verify = useMutation({
    mutationFn: () => {
      if (!challengeId) throw new Error("请先获取验证码");
      return window.openerx.verifyEmailCode({ challengeId, code });
    },
    onSuccess: (state) => {
      queryClient.setQueryData(accountKey, state);
      setCode("");
      setChallengeId(null);
      void queryClient.invalidateQueries({ queryKey: ["account", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["sync"] });
      void queryClient.invalidateQueries({ queryKey: ["usage"] });
    },
  });
  const signOut = useMutation({
    mutationFn: () => window.openerx.signOut(),
    onSuccess: async (state) => {
      queryClient.setQueryData(accountKey, state);
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
  });
  const signOutAll = useMutation({
    mutationFn: async () => {
      if (!window.confirm("退出全部设备后，所有设备都需要重新验证邮箱。是否继续？")) {
        return null;
      }
      return await window.openerx.signOutAll();
    },
    onSuccess: async (state) => {
      if (!state) return;
      queryClient.setQueryData(accountKey, state);
      queryClient.removeQueries({ queryKey: ["account", "devices"] });
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
  });
  const revokeDevice = useMutation({
    mutationFn: (sessionId: string) => window.openerx.revokeDevice({ sessionId }),
    onSuccess: async (state) => {
      queryClient.setQueryData(accountKey, state);
      await queryClient.invalidateQueries({ queryKey: ["account", "devices"] });
    },
  });
  const resolveConflict = useMutation({
    mutationFn: (input: { conflictId: string; resolution: "local" | "cloud" }) =>
      window.openerx.resolveSyncConflict(input),
    onSuccess: async (status) => {
      queryClient.setQueryData(["sync", "status"], status);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sync", "conflicts"] }),
        queryClient.invalidateQueries({ queryKey: ["chat"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
      ]);
    },
  });
  const clearLocalCache = useMutation({
    mutationFn: async () => {
      if (!window.confirm("仅清理本机缓存；云端对话会在下次同步时恢复。是否继续？")) return null;
      return await window.openerx.clearLocalCache();
    },
    onSuccess: async (result) => {
      if (!result) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["sync", "conflicts"] }),
      ]);
    },
  });
  const deleteCloudData = useMutation({
    mutationFn: async () => {
      if (
        !window.confirm(
          "删除账户云端对话会写入保留期墓碑，并同时清理本机缓存。该操作不同于退出设备。是否继续？",
        )
      ) {
        return null;
      }
      return await window.openerx.deleteCloudData();
    },
    onSuccess: async (result) => {
      if (!result) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["sync"] }),
      ]);
    },
  });

  if (account.isPending) return <main className="center-state">正在读取账户状态…</main>;
  const state = account.data;
  return (
    <main className="settings-page settings-account-page">
      <div className="settings-workbench">
        <nav className="settings-section-nav" aria-label="设置分区">
          <button type="button" className="settings-back-button" onClick={onClose}>
            <ArrowLeft size={18} />
            <span>返回应用</span>
          </button>
          <label className="settings-search-field">
            <MagnifyingGlass size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label="搜索设置"
              placeholder="搜索设置..."
              value={settingsSearch}
              onChange={(event) => setSettingsSearch(event.target.value)}
            />
          </label>
          <div className="settings-nav-scroll">
            {settingsSectionMatches("account") ||
            settingsSectionMatches("appearance") ||
            settingsSectionMatches("billing") ? (
              <section className="settings-nav-group">
                <p>个人</p>
                {renderSettingsNavButton("account", <UserCircle size={18} />)}
                {renderSettingsNavButton("appearance", <Sun size={18} />)}
                {renderSettingsNavButton("billing", <Receipt size={18} />)}
              </section>
            ) : null}
            {settingsSectionMatches("model") ||
            settingsSectionMatches("assistants") ||
            settingsSectionMatches("tools") ||
            settingsSectionMatches("memory") ? (
              <section className="settings-nav-group">
                <p>智能与能力</p>
                {renderSettingsNavButton("model", <SlidersHorizontal size={18} />)}
                {renderSettingsNavButton("assistants", <Sparkle size={18} />)}
                {renderSettingsNavButton("tools", <TerminalWindow size={18} />)}
                {renderSettingsNavButton("memory", <Brain size={18} />)}
              </section>
            ) : null}
            {settingsSectionMatches("update") || settingsSectionMatches("diagnostics") ? (
              <section className="settings-nav-group">
                <p>应用</p>
                {renderSettingsNavButton("update", <ArrowClockwise size={18} />)}
                {renderSettingsNavButton("diagnostics", <DownloadSimple size={18} />)}
              </section>
            ) : null}
            {!settingsSearchHasMatches ? (
              <p className="settings-search-empty">没有匹配的设置</p>
            ) : null}
          </div>
        </nav>
        <section
          className="settings-section-content"
          aria-label={`${accountSettingsSectionLabels[activeSection]}设置`}
        >
          {activeSection === "account" ? (
            <section
              className="settings-card settings-account-primary"
              id="account-section"
              tabIndex={-1}
              aria-label="账户状态"
            >
              <div>
                <span className={`account-status account-${state?.status ?? "unavailable"}`}>
                  {accountStatusLabel(state?.status)}
                </span>
                <h2>{state?.account?.displayName ?? `登录 ${desktopBrand.productName}`}</h2>
                <p>{state?.account?.email ?? "使用一次性邮箱验证码建立此设备会话。"}</p>
              </div>
              {state?.status !== "signed_in" || !state.session ? (
                <form
                  className="account-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (challengeId) verify.mutate();
                    else requestCode.mutate();
                  }}
                >
                  <label htmlFor="account-email">邮箱</label>
                  <input
                    id="account-email"
                    type="email"
                    value={email}
                    disabled={Boolean(challengeId)}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                  {challengeId ? (
                    <>
                      <label htmlFor="account-code">六位验证码</label>
                      <input
                        id="account-code"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        required
                      />
                    </>
                  ) : null}
                  <button
                    type="submit"
                    className="primary-action"
                    disabled={
                      requestCode.isPending ||
                      verify.isPending ||
                      (!challengeId && !email.trim()) ||
                      (Boolean(challengeId) && !/^\d{6}$/.test(code))
                    }
                  >
                    {challengeId ? "验证并登录" : "发送验证码"}
                  </button>
                  {!challengeId && !email.trim() ? (
                    <p className="field-help">输入邮箱后即可获取六位验证码。</p>
                  ) : null}
                  {requestCode.error || verify.error || state?.reason ? (
                    <p className="inline-error">
                      {requestCode.error?.message ??
                        verify.error?.message ??
                        accountReason(state?.reason)}
                    </p>
                  ) : null}
                </form>
              ) : null}
            </section>
          ) : null}
          {activeSection === "billing" ? (
            <section
              className="settings-card settings-stack settings-billing-entry"
              id="billing-section"
              tabIndex={-1}
              aria-label="费用与账单"
            >
              <div className="settings-heading">
                <div>
                  <h2>费用与账单</h2>
                  <p>查看账户额度、充值记录、消费明细和月度账单。</p>
                </div>
                <Receipt size={22} weight="regular" />
              </div>
              <NavLink className="primary-link" to="/settings/billing">
                查看费用与账单
              </NavLink>
            </section>
          ) : null}
          {activeSection === "appearance" ? (
            <div className="settings-section-panel" id="appearance-section" tabIndex={-1}>
              <ThemeSettings value={themePreference} onChange={onThemeChange} />
            </div>
          ) : null}
          {activeSection === "model" ? (
            <div className="settings-section-panel" id="model-section" tabIndex={-1}>
              <ModelServiceSettingsPanel />
              <ModelSettings value={defaultModelRef} onChange={onDefaultModelChange} />
            </div>
          ) : null}
          {activeSection === "assistants" ? <SkillCenter /> : null}
          {activeSection === "tools" ? <ToolCenter /> : null}
          {activeSection === "memory" ? (
            <div className="settings-section-panel" id="memory-section" tabIndex={-1}>
              <MemorySettingsPanel />
            </div>
          ) : null}
          {activeSection === "update" ? (
            <div className="settings-section-panel" id="update-section" tabIndex={-1}>
              <ReleaseUpdateSettings />
            </div>
          ) : null}
          {activeSection === "diagnostics" ? (
            <div className="settings-section-panel" id="diagnostics-section" tabIndex={-1}>
              <DiagnosticsSettings />
            </div>
          ) : null}
          {activeSection === "account" && state?.status === "signed_in" && state.session ? (
            <>
              <RemoteSettings />
              <section className="settings-card settings-stack" aria-label="设备会话">
                <div className="settings-heading">
                  <div>
                    <h2>设备会话</h2>
                    <p>Refresh 凭证只保存在各设备的系统凭证边界。</p>
                  </div>
                  <button type="button" onClick={() => void devices.refetch()}>
                    刷新设备
                  </button>
                </div>
                {(devices.data ?? [state.session]).map((session: DeviceSession) => {
                  const current = session.sessionId === state.session?.sessionId;
                  return (
                    <div className="device-card" key={session.sessionId}>
                      <div>
                        <strong>
                          {session.device.name} {current ? "· 当前设备" : ""}
                        </strong>
                        <span>
                          {session.device.platform} · {session.device.arch} · session v
                          {session.sessionVersion}
                        </span>
                        <span>{session.revokedAt ? `已撤销 ${session.revokedAt}` : "可用"}</span>
                      </div>
                      {!session.revokedAt ? (
                        <button
                          type="button"
                          onClick={() =>
                            current ? signOut.mutate() : revokeDevice.mutate(session.sessionId)
                          }
                          disabled={signOut.isPending || revokeDevice.isPending}
                        >
                          {current ? "退出此设备" : "撤销设备"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="danger-action"
                  onClick={() => signOutAll.mutate()}
                  disabled={signOutAll.isPending}
                >
                  退出全部设备
                </button>
                {devices.error || revokeDevice.error || signOut.error || signOutAll.error ? (
                  <p className="inline-error">
                    {
                      (devices.error ?? revokeDevice.error ?? signOut.error ?? signOutAll.error)
                        ?.message
                    }
                  </p>
                ) : null}
              </section>

              <section className="settings-card settings-stack" aria-label="同步状态">
                <div className="settings-heading">
                  <div>
                    <h2>账户同步</h2>
                    {sync.data ? (
                      <p>
                        最近成功 {new Date(sync.data.syncedAt).toLocaleString()} · 待上传{" "}
                        {sync.data.pending} · 冲突 {sync.data.conflicts}
                      </p>
                    ) : (
                      <p>正在读取同步状态…</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void sync.refetch()}
                    disabled={sync.isFetching}
                  >
                    立即同步
                  </button>
                </div>
                {sync.error ? (
                  <p className="inline-error">
                    同步失败：{sync.error.message}。本地内容仍在 Outbox，可稍后重试。
                  </p>
                ) : null}
                {conflicts.data?.map((conflict) => (
                  <div className="conflict-card" key={conflict.conflictId}>
                    <strong>
                      {conflict.objectType} · {conflict.objectId}
                    </strong>
                    <span>本机版本：{conflictPayload(conflict.clientPayload)}</span>
                    <span>云端版本：{conflictPayload(conflict.serverPayload)}</span>
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          resolveConflict.mutate({
                            conflictId: conflict.conflictId,
                            resolution: "local",
                          })
                        }
                      >
                        保留本机版本
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          resolveConflict.mutate({
                            conflictId: conflict.conflictId,
                            resolution: "cloud",
                          })
                        }
                      >
                        使用云端版本
                      </button>
                    </div>
                  </div>
                ))}
                {resolveConflict.error ? (
                  <p className="inline-error">冲突处理失败：{resolveConflict.error.message}</p>
                ) : null}
              </section>

              <section className="settings-card settings-stack" aria-label="账户 Token 用量">
                <h2>账户 Token 用量</h2>
                {accountUsage.data ? (
                  <div className="usage-line">
                    <span>{accountUsage.data.records} 次模型调用</span>
                    <span>输入 {tokenValue(accountUsage.data.inputTokens)}</span>
                    <span>缓存 {tokenValue(accountUsage.data.cachedInputTokens)}</span>
                    <span>输出 {tokenValue(accountUsage.data.outputTokens)}</span>
                    <span>推理 {tokenValue(accountUsage.data.reasoningTokens)}</span>
                    <strong>总计 {tokenValue(accountUsage.data.totalTokens)}</strong>
                  </div>
                ) : (
                  <p>暂无可核对的账户用量。</p>
                )}
              </section>

              <section className="settings-card settings-stack" aria-label="个人数据边界">
                <h2>个人数据边界</h2>
                <p>清本机缓存不会创建云端墓碑；退出设备不会删除本机历史或云端对话。</p>
                <div className="settings-actions">
                  <button type="button" onClick={() => clearLocalCache.mutate()}>
                    清理本机缓存
                  </button>
                  <button
                    type="button"
                    className="danger-action"
                    onClick={() => deleteCloudData.mutate()}
                  >
                    删除云端对话数据
                  </button>
                </div>
                {clearLocalCache.data ? <p>本机缓存已清理。</p> : null}
                {deleteCloudData.data ? (
                  <p>
                    已删除 {deleteCloudData.data.deletedObjects} 个云对象；墓碑保留至{" "}
                    {new Date(deleteCloudData.data.retainUntil).toLocaleString()}。
                  </p>
                ) : null}
                {clearLocalCache.error || deleteCloudData.error ? (
                  <p className="inline-error">
                    {(clearLocalCache.error ?? deleteCloudData.error)?.message}
                  </p>
                ) : null}
              </section>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function BillingAssetCards({ overview }: { overview: BillingOverview }): React.JSX.Element {
  const pointCount = overview.pointGrants.reduce((sum, grant) => sum + grant.remainingPoints, 0);
  return (
    <section className="billing-assets" aria-label="账户资产">
      <article>
        <span>可用额度</span>
        <strong>{cny(overview.quotaAvailableMinor)}</strong>
        <small>{overview.quotaGrants.length} 笔，按最早到期顺序使用</small>
      </article>
      <article>
        <span>可用积分</span>
        <strong>{pointCount.toLocaleString()} 分</strong>
        <small>按服务端兑换规则可抵 {cny(overview.pointAvailableMinor)}</small>
      </article>
      <article>
        <span>充值余额</span>
        <strong>{cny(overview.cash.postedMinor)}</strong>
        <small>当前可用 {cny(overview.cash.availableMinor)}</small>
      </article>
      <article className="billing-total">
        <span>总可用价值</span>
        <strong>{cny(overview.totalAvailableMinor)}</strong>
        <small>预留中 {cny(overview.activeReservationsMinor)}</small>
      </article>
    </section>
  );
}

function ChargeRow({ charge }: { charge: ChargeRecord }): React.JSX.Element {
  return (
    <div className="billing-row" data-charge-status={charge.status}>
      <div>
        <strong>{charge.effectiveModelRef}</strong>
        <span>{new Date(charge.settledAt ?? charge.createdAt).toLocaleString()}</span>
        <span>
          Token：输入 {charge.usage.inputTokens ?? "未知"} · 缓存{" "}
          {charge.usage.cachedInputTokens ?? "未知"} · 输出 {charge.usage.outputTokens ?? "未知"} ·
          推理 {charge.usage.reasoningTokens ?? "未知"}
        </span>
        <span>
          服务端价格 {charge.pricingSnapshot.version} · {charge.pricingSnapshot.description}
        </span>
      </div>
      <div>
        <span>额度 {cny(charge.quotaDeductionMinor)}</span>
        <span>
          积分 {charge.pointsDeducted.toLocaleString()} · {cny(charge.pointDeductionMinor)}
        </span>
        <span>余额 {cny(charge.cashDeductionMinor)}</span>
      </div>
      <strong>{cny(charge.finalAmountMinor)}</strong>
      <code>{charge.chargeId}</code>
      {charge.pendingReason ? <span>待核算：{charge.pendingReason}</span> : null}
    </div>
  );
}

function RechargeRow({ order }: { order: RechargeOrder }): React.JSX.Element {
  return (
    <div className="billing-row">
      <div>
        <strong>{order.provider === "alipay" ? "支付宝" : "微信支付"}</strong>
        <span>{new Date(order.createdAt).toLocaleString()}</span>
      </div>
      <span className={`billing-status status-${order.status}`}>{order.status}</span>
      <strong>{cny(order.amountMinor)}</strong>
      {order.checkoutUrl ? (
        <a href={order.checkoutUrl} target="_blank" rel="noreferrer">
          打开托管收银台
        </a>
      ) : null}
      <code>{order.orderId}</code>
    </div>
  );
}

function RefundRow({ refund }: { refund: RefundOrder }): React.JSX.Element {
  return (
    <div className="billing-row">
      <div>
        <strong>退款 · {refund.reason}</strong>
        <span>{new Date(refund.createdAt).toLocaleString()}</span>
      </div>
      <span className={`billing-status status-${refund.status}`}>{refund.status}</span>
      <strong>-{cny(refund.amountMinor)}</strong>
      <code>{refund.refundId}</code>
    </div>
  );
}

function BillingSettings(): React.JSX.Element {
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: accountKey,
    queryFn: () => window.openerx.getAccountState(),
  });
  const signedIn = account.data?.status === "signed_in";
  const terms = useQuery({
    queryKey: [...billingKey, "terms"],
    queryFn: () => window.openerx.getBillingTerms(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const overview = useQuery({
    queryKey: [...billingKey, "overview"],
    queryFn: () => window.openerx.getBillingOverview(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const charges = useQuery({
    queryKey: [...billingKey, "charges"],
    queryFn: () => window.openerx.listCharges(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const ledger = useQuery({
    queryKey: [...billingKey, "ledger"],
    queryFn: () => window.openerx.listLedger(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const orders = useQuery({
    queryKey: [...billingKey, "orders"],
    queryFn: () => window.openerx.listRechargeOrders(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const refunds = useQuery({
    queryKey: [...billingKey, "refunds"],
    queryFn: () => window.openerx.listRefunds(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const acceptTerms = useMutation({
    mutationFn: () => {
      if (!terms.data) throw new Error("收费条款尚未加载");
      return window.openerx.acceptBillingTerms(terms.data.terms.version);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...billingKey, "terms"] }),
  });
  const [rechargeMinor, setRechargeMinor] = useState(5_000);
  const [provider, setProvider] = useState<"alipay" | "wechat">("alipay");
  const createOrder = useMutation({
    mutationFn: () =>
      window.openerx.createRechargeOrder({
        amountMinor: rechargeMinor,
        provider,
        idempotencyKey: idempotencyKey("recharge"),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...billingKey, "orders"] }),
  });
  const [statementMonth, setStatementMonth] = useState(previousMonth);
  const statement = useMutation({
    mutationFn: () => window.openerx.exportBillingStatement(statementMonth),
  });

  if (account.isPending) return <main className="center-state">正在读取账户状态…</main>;
  if (!signedIn) {
    return (
      <main className="settings-page">
        <p className="eyebrow">账户费用</p>
        <h1>费用与账单</h1>
        <section className="settings-card settings-stack billing-signin-card">
          <h2>需要登录</h2>
          <p>登录后可以查看模型用量、余额、充值记录、消费明细和可下载的月度账单。</p>
          <NavLink className="primary-link" to="/settings/account">
            登录并查看账单
          </NavLink>
        </section>
      </main>
    );
  }

  const loadError =
    terms.error ??
    overview.error ??
    charges.error ??
    ledger.error ??
    orders.error ??
    refunds.error ??
    null;
  return (
    <main className="settings-page billing-page">
      <p className="eyebrow">账户费用</p>
      <h1>费用与账单</h1>
      <p className="billing-server-note">
        Token 计量、费率匹配、报价、资金预留与最终扣费全部由服务端完成；本页只显示服务端返回的最终
        Billing 信息。
      </p>

      {overview.data ? <BillingAssetCards overview={overview.data} /> : null}

      <section className="settings-card settings-stack" aria-label="收费条款">
        <div className="settings-heading">
          <div>
            <h2>收费条款</h2>
            <p>{terms.data?.terms.summary ?? "正在读取当前条款…"}</p>
          </div>
          {terms.data?.acceptance ? (
            <span className="billing-status status-credited">
              已接受 {new Date(terms.data.acceptance.acceptedAt).toLocaleString()}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => acceptTerms.mutate()}
              disabled={!terms.data || acceptTerms.isPending}
            >
              接受当前条款
            </button>
          )}
        </div>
        {terms.data ? (
          <code>
            版本 {terms.data.terms.version} · 内容 {terms.data.terms.contentHash.slice(0, 12)}
          </code>
        ) : null}
      </section>

      <section className="settings-card settings-stack" aria-label="充值">
        <div className="settings-heading">
          <div>
            <h2>充值</h2>
            <p>客户端只创建订单；支付结果必须经服务端验签后才会进入余额。</p>
          </div>
          <form
            className="billing-order-form"
            onSubmit={(event) => {
              event.preventDefault();
              createOrder.mutate();
            }}
          >
            <label>
              金额
              <select
                value={rechargeMinor}
                onChange={(event) => setRechargeMinor(Number(event.target.value))}
              >
                <option value={1_000}>¥10</option>
                <option value={5_000}>¥50</option>
                <option value={10_000}>¥100</option>
              </select>
            </label>
            <label>
              渠道
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value as "alipay" | "wechat")}
              >
                <option value="alipay">支付宝</option>
                <option value="wechat">微信支付</option>
              </select>
            </label>
            <button type="submit" disabled={createOrder.isPending}>
              创建充值订单
            </button>
          </form>
        </div>
        {createOrder.data ? (
          <p>
            订单 {createOrder.data.orderId} 已创建，当前状态 {createOrder.data.status}
            。到账以服务端状态为准。
            {createOrder.data.checkoutUrl ? (
              <>
                {" "}
                <a href={createOrder.data.checkoutUrl} target="_blank" rel="noreferrer">
                  打开托管收银台
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        <div className="billing-list">
          {orders.data?.map((order) => (
            <RechargeRow key={order.orderId} order={order} />
          ))}
          {orders.data?.length === 0 ? <p>暂无充值订单。</p> : null}
          {refunds.data?.map((refund) => (
            <RefundRow key={refund.refundId} refund={refund} />
          ))}
        </div>
      </section>

      <section className="settings-card settings-stack" aria-label="消费明细">
        <div className="settings-heading">
          <div>
            <h2>最终消费明细</h2>
            <p>每笔记录来自服务端 Usage → Charge → Ledger 结算链路。</p>
          </div>
          <span>{charges.data?.length ?? 0} 笔</span>
        </div>
        <div className="billing-list">
          {charges.data?.map((charge) => (
            <ChargeRow key={charge.chargeId} charge={charge} />
          ))}
          {charges.data?.length === 0 ? <p>暂无消费记录。</p> : null}
        </div>
      </section>

      <section className="settings-card settings-stack" aria-label="月度账单">
        <div className="settings-heading">
          <div>
            <h2>月度账单</h2>
            <p>已生成账单不可覆盖；后续退款或调整进入后续账期。</p>
          </div>
          <form
            className="billing-order-form"
            onSubmit={(event) => {
              event.preventDefault();
              statement.mutate();
            }}
          >
            <label>
              月份
              <input
                type="month"
                value={statementMonth}
                onChange={(event) => setStatementMonth(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={statement.isPending}>
              生成账单
            </button>
          </form>
        </div>
        {statement.data ? (
          <div className="statement-result">
            <span>期初 {cny(statement.data.statement.openingMinor)}</span>
            <span>消费 {cny(statement.data.statement.chargesMinor)}</span>
            <span>充值 {cny(statement.data.statement.creditsMinor)}</span>
            <span>退款 {cny(statement.data.statement.refundsMinor)}</span>
            <span>冲正 {cny(statement.data.statement.reversalsMinor)}</span>
            <strong>期末 {cny(statement.data.statement.closingMinor)}</strong>
            <a
              download={`openerx-billing-${statementMonth}.csv`}
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(statement.data.csv)}`}
            >
              下载 CSV
            </a>
            <a
              download={`openerx-billing-${statementMonth}.pdf`}
              href={`data:application/pdf;base64,${statement.data.pdfBase64}`}
            >
              下载 PDF
            </a>
          </div>
        ) : null}
      </section>

      <section className="settings-card settings-stack" aria-label="账本状态">
        <h2>账本状态</h2>
        <p>{ledger.data?.length ?? 0} 个平衡业务事务；客户端无写余额或账本接口。</p>
      </section>

      {loadError || acceptTerms.error || createOrder.error || statement.error ? (
        <p className="inline-error">
          {(loadError ?? acceptTerms.error ?? createOrder.error ?? statement.error)?.message}
        </p>
      ) : null}
    </main>
  );
}

type ToolCenterCategory = "all" | "builtin" | "mcp" | "browser" | "search" | "system";

type ToolCenterRow = {
  id: string;
  name: string;
  detail: string;
  source: string;
  category: Exclude<ToolCenterCategory, "all">;
  capability: ToolRuntimeCapability;
  status: string;
  statusTone: "enabled" | "warning" | "muted";
  enabled: boolean;
  mcpServerId?: string;
};

function ToolCenter({ showTitle = true }: { showTitle?: boolean } = {}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [activeCategory, setActiveCategory] = useState<ToolCenterCategory>("all");
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [mcpNotice, setMcpNotice] = useState<string | null>(null);
  const [nativePermissionNotice, setNativePermissionNotice] = useState<string | null>(null);
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "streamable_http">("stdio");
  const [mcpEndpoint, setMcpEndpoint] = useState("");
  const [mcpCwd, setMcpCwd] = useState("");
  const [mcpAuth, setMcpAuth] = useState<"none" | "bearer" | "oauth">("none");
  const [mcpToken, setMcpToken] = useState("");
  const [mcpOAuthClientId, setMcpOAuthClientId] = useState("");
  const [mcpOAuthScope, setMcpOAuthScope] = useState("");
  const [localWebSearchNotice, setLocalWebSearchNotice] = useState<string | null>(null);
  const [localWebSearchDraft, setLocalWebSearchDraft] = useState<LocalWebSearchSettingsSelection>({
    providerId: "direct:baidu-json",
    locale: "zh-CN",
    safeSearch: "moderate",
  });

  const runtimeReadiness = useQuery({
    queryKey: ["tools", "runtime-readiness"],
    queryFn: () => window.openerx.listToolRuntimeReadiness(),
  });
  const localWebSearchSettings = useQuery({
    queryKey: ["tools", "local-web-search", "settings"],
    queryFn: () => window.openerx.getLocalWebSearchSettings(),
  });
  const mcpServers = useQuery({
    queryKey: ["tools", "mcp-servers"],
    queryFn: () => window.openerx.listMcpServers(),
  });
  const mcpAuthorization = useQuery({
    queryKey: ["tools", "mcp-authorization"],
    queryFn: () => window.openerx.listMcpServerAuthorizationStates(),
  });

  useEffect(() => {
    if (!localWebSearchSettings.data) return;
    setLocalWebSearchDraft({
      providerId: localWebSearchSettings.data.providerId,
      locale: localWebSearchSettings.data.locale,
      safeSearch: localWebSearchSettings.data.safeSearch,
    });
  }, [localWebSearchSettings.data]);

  const saveLocalWebSearchSettings = useMutation({
    mutationFn: (input: LocalWebSearchSettingsSelection) =>
      window.openerx.updateLocalWebSearchSettings(input),
    onSuccess: async (state) => {
      queryClient.setQueryData<LocalWebSearchSettingsState>(
        ["tools", "local-web-search", "settings"],
        state,
      );
      await queryClient.invalidateQueries({ queryKey: ["tools", "runtime-readiness"] });
      setLocalWebSearchNotice("搜索设置已保存。");
    },
  });
  const resetLocalWebSearchRuntime = useMutation({
    mutationFn: () => window.openerx.resetLocalWebSearchRuntime(),
    onSuccess: async (state) => {
      queryClient.setQueryData<LocalWebSearchSettingsState>(
        ["tools", "local-web-search", "settings"],
        state,
      );
      await queryClient.invalidateQueries({ queryKey: ["tools", "runtime-readiness"] });
      setLocalWebSearchNotice("已清除缓存并重置搜索服务。");
    },
  });
  const requestNativePermission = useMutation({
    mutationFn: (permission: "screen_capture" | "accessibility") =>
      window.openerx.requestDesktopNativePermission({ permission }),
    onSuccess: async (state) => {
      await queryClient.invalidateQueries({ queryKey: ["tools", "runtime-readiness"] });
      setNativePermissionNotice(
        state.status === "granted"
          ? "系统权限已生效。"
          : state.settingsOpened
            ? "系统设置已打开；授权后请返回并刷新工具状态。"
            : "当前系统无法请求该权限。",
      );
    },
  });
  const saveMcp = useMutation({
    mutationFn: (config: McpServerConfig) =>
      window.openerx.saveMcpServer({
        config,
        ...(mcpTransport === "streamable_http" && mcpAuth === "bearer" && mcpToken
          ? { bearerToken: mcpToken }
          : {}),
        ...(mcpTransport === "streamable_http" && mcpAuth === "oauth" && mcpOAuthClientId
          ? {
              oauthClientId: mcpOAuthClientId,
              ...(mcpOAuthScope ? { oauthScope: mcpOAuthScope } : {}),
            }
          : mcpAuth === "oauth" && mcpOAuthScope
            ? { oauthScope: mcpOAuthScope }
            : {}),
      }),
    onSuccess: async (saved) => {
      setMcpName("");
      setMcpEndpoint("");
      setMcpCwd("");
      setMcpToken("");
      setMcpOAuthClientId("");
      setMcpOAuthScope("");
      setAddDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["tools", "mcp-servers"] });
      await queryClient.invalidateQueries({ queryKey: ["tools", "mcp-authorization"] });
      await queryClient.invalidateQueries({ queryKey: ["tools", "runtime-readiness"] });
      setMcpNotice(`已添加工具“${saved.name}”。`);
    },
  });
  const toggleMcp = useMutation({
    mutationFn: (server: McpServerConfig) =>
      window.openerx.saveMcpServer({ config: { ...server, enabled: !server.enabled } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tools", "mcp-servers"] });
      await queryClient.invalidateQueries({ queryKey: ["tools", "runtime-readiness"] });
    },
  });
  const authorizeMcp = useMutation({
    mutationFn: (serverId: string) => window.openerx.authorizeMcpServer({ serverId }),
    onSuccess: async (state) => {
      queryClient.setQueryData<McpServerAuthorizationState[]>(
        ["tools", "mcp-authorization"],
        (current = []) => [...current.filter(({ serverId }) => serverId !== state.serverId), state],
      );
      await queryClient.invalidateQueries({ queryKey: ["tools", "runtime-readiness"] });
      setMcpNotice("OAuth 授权完成，工具已连接。");
    },
  });
  const removeMcp = useMutation({
    mutationFn: (serverId: string) => window.openerx.removeMcpServer({ serverId }),
    onSuccess: async () => {
      setSelectedToolId(null);
      await queryClient.invalidateQueries({ queryKey: ["tools", "mcp-servers"] });
      await queryClient.invalidateQueries({ queryKey: ["tools", "runtime-readiness"] });
      setMcpNotice("已移除 MCP 工具及其本机凭证引用。");
    },
  });

  const readinessByCapability = useMemo(
    () =>
      new Map<ToolRuntimeCapability, ToolRuntimeReadiness>(
        runtimeReadiness.data?.map((entry) => [entry.capability, entry]) ?? [],
      ),
    [runtimeReadiness.data],
  );

  const toolRows = useMemo<ToolCenterRow[]>(() => {
    const categoryFor = (capability: ToolRuntimeCapability): Exclude<ToolCenterCategory, "all"> => {
      if (capability === "mcp") return "mcp";
      if (capability === "browser") return "browser";
      if (capability === "web.search") return "search";
      if (capability === "file" || capability === "shell" || capability === "desktop") {
        return "system";
      }
      return "builtin";
    };
    const sourceFor = (capability: ToolRuntimeCapability): string => {
      if (capability === "mcp") return "MCP / 外部连接";
      if (capability === "browser") return "内置 / 浏览器";
      if (capability === "web.search") return "内置 / 搜索";
      if (capability === "file" || capability === "shell" || capability === "desktop") {
        return "内置 / 文件与系统";
      }
      return "内置";
    };
    const builtins = toolCatalog
      .filter((tool) => tool.capability !== "mcp" || !mcpServers.data?.length)
      .map<ToolCenterRow>((tool) => {
        const readiness = readinessByCapability.get(tool.capability);
        const status = readiness?.status;
        return {
          id: `capability:${tool.capability}`,
          name: tool.name,
          detail: tool.detail,
          source: sourceFor(tool.capability),
          category: categoryFor(tool.capability),
          capability: tool.capability,
          status:
            status === "available"
              ? "已启用"
              : status === "degraded"
                ? "部分可用"
                : status === "authorization_required"
                  ? "未配置"
                  : status === "unavailable"
                    ? "不可用"
                    : runtimeReadiness.isFetching
                      ? "检测中"
                      : "状态未知",
          statusTone:
            status === "available"
              ? "enabled"
              : status === "degraded" || status === "authorization_required"
                ? "warning"
                : "muted",
          enabled: status === "available" || status === "degraded",
        };
      });
    const external =
      mcpServers.data?.map<ToolCenterRow>((server) => ({
        id: `mcp:${server.id}`,
        name: server.name,
        detail:
          server.transport === "stdio"
            ? "通过本机进程提供外部工具"
            : "通过网络 MCP 服务提供外部工具",
        source: server.transport === "stdio" ? "MCP / 本机进程" : "MCP / 网络服务",
        category: "mcp",
        capability: "mcp",
        status: server.enabled ? "已启用" : "已停用",
        statusTone: server.enabled ? "enabled" : "muted",
        enabled: server.enabled,
        mcpServerId: server.id,
      })) ?? [];
    return [...builtins, ...external];
  }, [mcpServers.data, readinessByCapability, runtimeReadiness.isFetching]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchText.trim().toLocaleLowerCase();
    return toolRows.filter((row) => {
      const matchesCategory = activeCategory === "all" || row.category === activeCategory;
      const matchesSearch =
        !normalizedSearch ||
        `${row.name} ${row.detail} ${row.source}`.toLocaleLowerCase().includes(normalizedSearch);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchText, toolRows]);

  const selectedRow = toolRows.find((row) => row.id === selectedToolId) ?? null;
  const selectedReadiness = selectedRow
    ? readinessByCapability.get(selectedRow.capability)
    : undefined;
  const selectedMcp = selectedRow?.mcpServerId
    ? mcpServers.data?.find((server) => server.id === selectedRow.mcpServerId)
    : undefined;
  const selectedAuthorization = selectedMcp
    ? mcpAuthorization.data?.find(({ serverId }) => serverId === selectedMcp.id)
    : undefined;

  const categories: Array<{ id: ToolCenterCategory; label: string }> = [
    { id: "all", label: "全部" },
    { id: "builtin", label: "内置" },
    { id: "mcp", label: "MCP" },
    { id: "browser", label: "浏览器" },
    { id: "search", label: "搜索" },
    { id: "system", label: "文件与系统" },
  ];

  const renderToolIcon = (capability: ToolRuntimeCapability): React.JSX.Element => {
    if (capability === "web.search") return <MagnifyingGlass size={24} />;
    if (capability === "browser") return <Desktop size={24} />;
    if (capability === "file") return <FolderSimple size={24} />;
    if (capability === "shell") return <TerminalWindow size={24} />;
    if (capability === "image.generate") return <ImageSquare size={24} />;
    if (capability === "desktop") return <SlidersHorizontal size={24} />;
    if (capability === "mcp") return <GearSix size={24} />;
    if (capability === "builtin.compute") return <Brain size={24} />;
    return <Sparkle size={24} />;
  };

  return (
    <section className="tool-center-page settings-tool-center" id="tools-section" tabIndex={-1}>
      <header className="tool-library-header">
        <div>
          {showTitle ? <h2>工具</h2> : null}
          <p>添加、设置并管理 {desktopBrand.productName} 可以使用的工具</p>
        </div>
        <button type="button" className="tool-add-button" onClick={() => setAddDialogOpen(true)}>
          <Plus size={18} weight="bold" />
          添加工具
        </button>
      </header>

      <div className="tool-library-toolbar">
        <div className="tool-category-tabs" role="tablist" aria-label="工具分类">
          {categories.map((category) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === category.id}
              className={activeCategory === category.id ? "is-active" : ""}
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
        <label className="tool-search-field">
          <MagnifyingGlass size={18} />
          <input
            type="search"
            placeholder="搜索工具"
            aria-label="搜索工具"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </label>
      </div>

      {mcpNotice ? (
        <p className="inline-success tool-library-notice" role="status">
          {mcpNotice}
        </p>
      ) : null}

      <section className="tool-library-table" aria-label="工具列表">
        <div className="tool-library-row tool-library-columns" aria-hidden="true">
          <span>工具名称</span>
          <span>描述</span>
          <span>来源 / 类型</span>
          <span>状态</span>
          <span>启用</span>
          <span>操作</span>
        </div>
        {filteredRows.map((row) => {
          const mcpServer = row.mcpServerId
            ? mcpServers.data?.find((server) => server.id === row.mcpServerId)
            : undefined;
          return (
            <article className="tool-library-row" key={row.id}>
              <div className="tool-library-name">
                <span className="tool-library-icon" aria-hidden="true">
                  {renderToolIcon(row.capability)}
                </span>
                <strong>{row.name}</strong>
              </div>
              <p>{row.detail}</p>
              <span className="tool-library-source">{row.source}</span>
              <span className={`tool-library-status is-${row.statusTone}`}>{row.status}</span>
              <label className="tool-library-switch">
                <span className="visually-hidden">启用 {row.name}</span>
                <input
                  type="checkbox"
                  checked={row.enabled}
                  disabled={!mcpServer || toggleMcp.isPending}
                  readOnly={!mcpServer}
                  onChange={() => {
                    if (mcpServer) toggleMcp.mutate(mcpServer);
                  }}
                />
              </label>
              <button
                type="button"
                className="tool-row-settings"
                onClick={() => setSelectedToolId(row.id)}
              >
                <GearSix size={17} />
                设置
              </button>
            </article>
          );
        })}
        {!filteredRows.length ? (
          <div className="tool-library-empty">
            <MagnifyingGlass size={24} />
            <strong>没有找到匹配的工具</strong>
            <span>试试其他关键词或分类。</span>
          </div>
        ) : null}
      </section>

      {selectedRow ? (
        <div className="tool-modal-backdrop" role="presentation">
          <section
            className="tool-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tool-settings-title"
          >
            <header className="tool-modal-header">
              <div className="tool-modal-title">
                <span className="tool-library-icon" aria-hidden="true">
                  {renderToolIcon(selectedRow.capability)}
                </span>
                <div>
                  <h2 id="tool-settings-title">{selectedRow.name}</h2>
                  <p>{selectedRow.detail}</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭工具设置"
                onClick={() => setSelectedToolId(null)}
              >
                <X size={19} />
              </button>
            </header>

            <div className="tool-modal-summary">
              <div>
                <span>来源 / 类型</span>
                <strong>{selectedRow.source}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{selectedRow.status}</strong>
              </div>
            </div>

            {selectedRow.capability === "web.search" ? (
              <section className="tool-settings-section" aria-label="本地 Web Search">
                <div className="tool-settings-heading">
                  <div>
                    <h3>设置</h3>
                    <p>选择首选搜索引擎、结果语言和安全级别；失败时自动切换备用引擎。</p>
                  </div>
                  <button
                    type="button"
                    disabled={resetLocalWebSearchRuntime.isPending}
                    onClick={() => resetLocalWebSearchRuntime.mutate()}
                  >
                    {resetLocalWebSearchRuntime.isPending ? "正在重置…" : "重置搜索服务"}
                  </button>
                </div>
                <form
                  className="tool-search-settings-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveLocalWebSearchSettings.mutate(localWebSearchDraft);
                  }}
                >
                  <label>
                    <span>首选搜索引擎</span>
                    <select
                      aria-label="Web Search Provider"
                      value={localWebSearchDraft.providerId}
                      onChange={(event) =>
                        setLocalWebSearchDraft((current) => ({
                          ...current,
                          providerId: event.target
                            .value as LocalWebSearchSettingsSelection["providerId"],
                        }))
                      }
                    >
                      <option value="direct:baidu-json">百度 JSON（默认）</option>
                      <option value="direct:bing-html">Bing HTML</option>
                    </select>
                  </label>
                  <label>
                    <span>结果语言</span>
                    <select
                      aria-label="Web Search 结果语言"
                      value={localWebSearchDraft.locale}
                      onChange={(event) =>
                        setLocalWebSearchDraft((current) => ({
                          ...current,
                          locale: event.target.value as LocalWebSearchSettingsSelection["locale"],
                        }))
                      }
                    >
                      <option value="zh-CN">简体中文</option>
                      <option value="en-US">English (US)</option>
                    </select>
                  </label>
                  <label>
                    <span>安全搜索</span>
                    <select
                      aria-label="Web Search SafeSearch"
                      value={localWebSearchDraft.safeSearch}
                      onChange={(event) =>
                        setLocalWebSearchDraft((current) => ({
                          ...current,
                          safeSearch: event.target
                            .value as LocalWebSearchSettingsSelection["safeSearch"],
                        }))
                      }
                    >
                      <option value="off">关闭</option>
                      <option value="moderate">适中（默认）</option>
                      <option value="strict">严格</option>
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="primary-action"
                    disabled={saveLocalWebSearchSettings.isPending}
                  >
                    {saveLocalWebSearchSettings.isPending ? "正在保存…" : "保存设置"}
                  </button>
                </form>
                <div className="tool-provider-list">
                  {localWebSearchSettings.data?.providers.map((provider) => (
                    <div key={provider.descriptor.providerId}>
                      <span>
                        <strong>{provider.descriptor.displayName}</strong>
                        {provider.selected ? <small>首选</small> : null}
                      </span>
                      <span className={`is-${provider.status}`}>
                        {localWebSearchProviderStatusLabels[provider.status]}
                      </span>
                      {provider.lastErrorCode ? <small>{provider.lastErrorCode}</small> : null}
                    </div>
                  ))}
                </div>
                {localWebSearchNotice ? (
                  <p className="inline-success" role="status">
                    {localWebSearchNotice}
                  </p>
                ) : null}
                {localWebSearchSettings.error ||
                saveLocalWebSearchSettings.error ||
                resetLocalWebSearchRuntime.error ? (
                  <p className="inline-error" role="alert">
                    {userFacingError(
                      localWebSearchSettings.error ??
                        saveLocalWebSearchSettings.error ??
                        resetLocalWebSearchRuntime.error,
                      "本地搜索设置暂时不可用，请稍后重试。",
                    )}
                  </p>
                ) : null}
              </section>
            ) : selectedMcp ? (
              <section className="tool-settings-section">
                <div className="tool-mcp-detail">
                  <span>连接方式</span>
                  <strong>
                    {selectedMcp.transport === "stdio" ? "本机进程（STDIO）" : "网络服务（HTTP）"}
                  </strong>
                  <span>连接地址</span>
                  <strong>
                    {selectedMcp.transport === "stdio" ? selectedMcp.command : selectedMcp.url}
                  </strong>
                  {selectedMcp.transport === "streamable_http" ? (
                    <>
                      <span>认证</span>
                      <strong>
                        {selectedMcp.auth === "none"
                          ? "无认证"
                          : selectedMcp.auth === "bearer"
                            ? "Bearer 令牌"
                            : selectedAuthorization
                              ? mcpAuthorizationLabels[selectedAuthorization.status]
                              : "正在读取 OAuth 状态"}
                      </strong>
                    </>
                  ) : null}
                </div>
                <div className="tool-modal-actions">
                  {selectedMcp.transport === "streamable_http" && selectedMcp.auth === "oauth" ? (
                    <button
                      type="button"
                      disabled={authorizeMcp.isPending || !selectedMcp.enabled}
                      onClick={() => authorizeMcp.mutate(selectedMcp.id)}
                    >
                      {authorizeMcp.isPending ? "等待浏览器授权…" : "在浏览器中授权"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="danger-action"
                    disabled={removeMcp.isPending}
                    onClick={() => removeMcp.mutate(selectedMcp.id)}
                  >
                    移除工具
                  </button>
                </div>
                {authorizeMcp.error ? (
                  <p className="inline-error">
                    {userFacingError(authorizeMcp.error, "OAuth 授权失败，请检查服务地址后重试。")}
                  </p>
                ) : null}
              </section>
            ) : (
              <section className="tool-settings-section">
                <h3>工具信息</h3>
                <p>
                  {toolRuntimeReason(selectedReadiness?.reason ?? null) ??
                    `此工具由 ${desktopBrand.productName} 提供，当前不需要额外设置。`}
                </p>
                {selectedReadiness?.details?.length ? (
                  <ul>
                    {selectedReadiness.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                ) : null}
                {selectedRow.capability === "mcp" ? (
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => {
                      setSelectedToolId(null);
                      setAddDialogOpen(true);
                    }}
                  >
                    添加 MCP 工具
                  </button>
                ) : null}
                {selectedRow.capability === "desktop" &&
                selectedReadiness?.reason === "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED" ? (
                  <button
                    type="button"
                    disabled={requestNativePermission.isPending}
                    onClick={() => requestNativePermission.mutate("screen_capture")}
                  >
                    打开屏幕录制设置
                  </button>
                ) : null}
                {selectedRow.capability === "desktop" &&
                selectedReadiness?.reason === "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED" ? (
                  <button
                    type="button"
                    disabled={requestNativePermission.isPending}
                    onClick={() => requestNativePermission.mutate("accessibility")}
                  >
                    请求辅助功能权限
                  </button>
                ) : null}
                {nativePermissionNotice ? <p role="status">{nativePermissionNotice}</p> : null}
              </section>
            )}
          </section>
        </div>
      ) : null}

      {addDialogOpen ? (
        <div className="tool-modal-backdrop" role="presentation">
          <section
            className="tool-modal tool-add-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-tool-title"
          >
            <header className="tool-modal-header">
              <div>
                <h2 id="add-tool-title">添加工具</h2>
                <p>通过 MCP 连接本机进程或网络工具服务。</p>
              </div>
              <button
                type="button"
                aria-label="关闭添加工具"
                onClick={() => setAddDialogOpen(false)}
              >
                <X size={19} />
              </button>
            </header>
            <form
              className="mcp-config-form tool-add-form"
              aria-label="添加 MCP 服务"
              onSubmit={(event) => {
                event.preventDefault();
                const id = crypto.randomUUID();
                const config: McpServerConfig =
                  mcpTransport === "stdio"
                    ? {
                        id,
                        name: mcpName,
                        transport: "stdio",
                        command: mcpEndpoint,
                        args: [],
                        cwd: mcpCwd,
                        enabled: true,
                        enabledTools: [],
                      }
                    : {
                        id,
                        name: mcpName,
                        transport: "streamable_http",
                        url: mcpEndpoint,
                        auth: mcpAuth,
                        credentialRef: null,
                        enabled: true,
                        enabledTools: [],
                      };
                saveMcp.mutate(config);
              }}
            >
              <label className="mcp-field">
                <span>显示名称</span>
                <input
                  aria-label="MCP 名称"
                  placeholder="例如：项目知识库"
                  value={mcpName}
                  onChange={(event) => setMcpName(event.target.value)}
                  required
                />
              </label>
              <label className="mcp-field">
                <span>连接方式</span>
                <select
                  aria-label="MCP 传输"
                  value={mcpTransport}
                  onChange={(event) =>
                    setMcpTransport(event.target.value as "stdio" | "streamable_http")
                  }
                >
                  <option value="stdio">本机进程（STDIO）</option>
                  <option value="streamable_http">网络服务（Streamable HTTP）</option>
                </select>
              </label>
              <label className="mcp-field">
                <span>{mcpTransport === "stdio" ? "启动命令" : "服务地址"}</span>
                <input
                  aria-label={mcpTransport === "stdio" ? "MCP 命令" : "MCP URL"}
                  placeholder={
                    mcpTransport === "stdio"
                      ? "例如：C:\\tools\\my-mcp.exe"
                      : "https://example.com/mcp"
                  }
                  value={mcpEndpoint}
                  onChange={(event) => setMcpEndpoint(event.target.value)}
                  required
                />
              </label>
              {mcpTransport === "stdio" ? (
                <label className="mcp-field">
                  <span>工作目录</span>
                  <input
                    aria-label="MCP 工作目录"
                    placeholder="例如：C:\\Users\\name\\project"
                    value={mcpCwd}
                    onChange={(event) => setMcpCwd(event.target.value)}
                    required
                  />
                  <small>服务进程从此目录启动；只填写你信任且明确授权的目录。</small>
                </label>
              ) : (
                <>
                  <label className="mcp-field">
                    <span>认证方式</span>
                    <select
                      aria-label="MCP 认证"
                      value={mcpAuth}
                      onChange={(event) => setMcpAuth(event.target.value as typeof mcpAuth)}
                    >
                      <option value="none">无认证</option>
                      <option value="bearer">Bearer 令牌</option>
                      <option value="oauth">OAuth 授权码（PKCE）</option>
                    </select>
                  </label>
                  {mcpAuth === "bearer" ? (
                    <label className="mcp-field">
                      <span>Bearer 令牌</span>
                      <input
                        aria-label="MCP Bearer Token"
                        type="password"
                        autoComplete="off"
                        placeholder="粘贴服务令牌"
                        value={mcpToken}
                        onChange={(event) => setMcpToken(event.target.value)}
                        required
                      />
                    </label>
                  ) : mcpAuth === "oauth" ? (
                    <>
                      <label className="mcp-field">
                        <span>OAuth Client ID（可选）</span>
                        <input
                          aria-label="MCP OAuth Client ID"
                          autoComplete="off"
                          placeholder="留空则尝试动态客户端注册"
                          value={mcpOAuthClientId}
                          onChange={(event) => setMcpOAuthClientId(event.target.value)}
                        />
                      </label>
                      <label className="mcp-field">
                        <span>OAuth Scope（可选）</span>
                        <input
                          aria-label="MCP OAuth Scope"
                          autoComplete="off"
                          placeholder="例如：tools.read"
                          value={mcpOAuthScope}
                          onChange={(event) => setMcpOAuthScope(event.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                </>
              )}
              <div className="tool-modal-actions">
                <button type="button" onClick={() => setAddDialogOpen(false)}>
                  取消
                </button>
                <button type="submit" className="primary-action" disabled={saveMcp.isPending}>
                  {saveMcp.isPending ? "正在添加…" : "添加工具"}
                </button>
              </div>
              {saveMcp.error ? (
                <p className="inline-error">
                  {userFacingError(saveMcp.error, "无法添加 MCP 工具，请检查字段后重试。")}
                </p>
              ) : null}
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function Sidebar({
  onCollapse,
  backgroundInert = false,
  assistantFeatureEnabled = false,
}: {
  onCollapse: () => void;
  backgroundInert?: boolean;
  assistantFeatureEnabled?: boolean;
}): React.JSX.Element {
  const [showArchived, setShowArchived] = useState(false);
  const history = useQuery({
    queryKey: chatKeys.list(showArchived),
    queryFn: () => window.openerx.listConversations({ includeArchived: showArchived }),
  });
  const account = useQuery({
    queryKey: accountKey,
    queryFn: () => window.openerx.getAccountState(),
  });
  const archivedCount = history.data?.filter(({ archivedAt }) => archivedAt !== null).length ?? 0;
  return (
    <aside
      className="sidebar"
      inert={backgroundInert ? true : undefined}
      aria-hidden={backgroundInert || undefined}
    >
      <div className="sidebar-top">
        <div className="brand-row">
          <div className="brand">
            <span className="brand-mark">
              {desktopBrand.logoDataUrl ? (
                <img src={desktopBrand.logoDataUrl} alt={desktopBrand.logoAlt} />
              ) : (
                <span className="brand-monogram" aria-hidden="true">
                  {desktopBrand.markText}
                </span>
              )}
            </span>
            <span className="brand-copy">
              <strong>{desktopBrand.productName}</strong>
              <small>{desktopBrand.displayName}</small>
            </span>
          </div>
          <button
            type="button"
            className="icon-button sidebar-collapse"
            aria-label="收起侧栏"
            onClick={onCollapse}
          >
            <SidebarSimple size={18} weight="regular" />
          </button>
        </div>
        <nav aria-label="新对话" className="main-nav sidebar-primary-nav">
          <NavLink to="/chat/new" className="new-chat-link">
            <Plus size={17} weight="bold" />
            <span>新对话</span>
          </NavLink>
        </nav>
      </div>
      <div className="sidebar-scroll" data-testid="sidebar-scroll">
        <nav aria-label="主导航" className="main-nav">
          <NavLink to="/search">
            <MagnifyingGlass size={17} />
            <span>搜索</span>
            <kbd>⌘K</kbd>
          </NavLink>
          <NavLink to="/files">
            <FolderSimple size={17} />
            <span>个人文件</span>
          </NavLink>
          <NavLink to="/automations">
            <ArrowClockwise size={17} />
            <span>自动化</span>
          </NavLink>
          {assistantFeatureEnabled ? (
            <NavLink to="/assistant">
              <PawPrint size={17} />
              <span>助手</span>
            </NavLink>
          ) : null}
          <NavLink to="/settings">
            <GearSix size={17} />
            <span>设置</span>
          </NavLink>
        </nav>
        <ProjectSidebar />
        <section className="history-list" aria-label="对话历史">
          <div className="history-heading">
            <span>{showArchived ? "历史 · 含归档" : "历史 · 活动"}</span>
            <button
              type="button"
              aria-label={showArchived ? "仅显示活动对话" : "显示归档对话"}
              aria-pressed={showArchived}
              onClick={() => setShowArchived((value) => !value)}
            >
              <SlidersHorizontal size={15} />
            </button>
          </div>
          {history.data?.map((conversation: ConversationSummary) => (
            <NavLink
              to={`/chat/${conversation.id}`}
              key={conversation.id}
              className={({ isActive }) =>
                `history-item${isActive ? " active history-item-active" : ""}`
              }
            >
              <ChatCircle size={16} weight="regular" />
              <strong>{conversation.title}</strong>
              <span>
                {conversation.archivedAt ? "已归档 · " : ""}
                {formatUpdatedAt(conversation.updatedAt)} · {conversation.lastMessagePreview}
              </span>
            </NavLink>
          ))}
          {history.isSuccess && history.data.length === 0 ? (
            <p className="history-empty">
              {showArchived ? "还没有活动或归档对话。" : "还没有活动对话。"}
            </p>
          ) : null}
          {showArchived && history.isSuccess && history.data.length > 0 && archivedCount === 0 ? (
            <p className="history-mode-note" role="status">
              已显示归档；目前没有归档对话。
            </p>
          ) : null}
        </section>
      </div>
      <NavLink className="sidebar-account" to="/settings/account">
        <UserCircle size={23} weight="regular" />
        <strong>{account.data?.account?.displayName ?? "未登录"}</strong>
        <span>
          {account.data?.status === "signed_in" ? account.data.account?.email : "登录以同步数据"}
        </span>
      </NavLink>
    </aside>
  );
}

export function App(): React.JSX.Element {
  const [contextOpen, setContextOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialThemePreference);
  const [defaultModelRef, setDefaultModelRef] = useState(initialDefaultModelRef);
  const [assistantCompanionEnabled, setAssistantCompanionEnabled] = useState(
    initialAssistantCompanionEnabled,
  );
  const [assistantFeatureEnabled] = useState(initialAssistantFeatureEnabled);
  const [automaticMemoryNotice, setAutomaticMemoryNotice] =
    useState<AutomaticMemoryCreatedEvent | null>(null);
  const [memoryUndoPending, setMemoryUndoPending] = useState(false);
  const [memoryUndoError, setMemoryUndoError] = useState<string | null>(null);
  const contextReturnFocus = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const settingsOpen =
    location.pathname.startsWith("/settings") || location.pathname === "/assistants";
  const lastNonSettingsLocation = useRef("/chat/new");
  const contextConversationId = /^\/chat\/([^/]+)$/u.exec(location.pathname)?.[1] ?? null;
  useEffect(() => {
    if (!settingsOpen) {
      lastNonSettingsLocation.current = `${location.pathname}${location.search}`;
    }
  }, [location.pathname, location.search, settingsOpen]);
  useEffect(() => {
    if (location.pathname) setContextOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        navigate("/search");
        window.requestAnimationFrame(() => document.getElementById("global-search-input")?.focus());
        return;
      }
      if (event.key === ",") {
        event.preventDefault();
        navigate("/settings/account");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [navigate]);

  useEffect(() => {
    const mediaQuery =
      themePreference === "system" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: light)")
        : null;
    const applyTheme = (): void => {
      const theme = resolvedTheme(themePreference);
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.themePreference = themePreference;
      document.documentElement.style.colorScheme = theme;
    };

    applyTheme();
    try {
      window.localStorage.setItem(themeStorageKey, themePreference);
    } catch {
      // Theme switching still works when storage is unavailable.
    }
    mediaQuery?.addEventListener("change", applyTheme);
    return () => mediaQuery?.removeEventListener("change", applyTheme);
  }, [themePreference]);

  useEffect(() => {
    try {
      window.localStorage.setItem(defaultModelStorageKey, defaultModelRef);
    } catch {
      // The current session still uses the selected model when storage is unavailable.
    }
  }, [defaultModelRef]);

  useEffect(() => {
    try {
      window.localStorage.setItem(assistantCompanionStorageKey, String(assistantCompanionEnabled));
    } catch {
      // The current session still keeps the companion preference.
    }
  }, [assistantCompanionEnabled]);

  const sequenceByConversation = useRef(new Map<string, number>());
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribeRun = window.openerx.onAutomationRun((run) => {
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
      void queryClient.invalidateQueries({
        queryKey: ["automations", run.automationId, "runs"],
      });
    });
    const unsubscribeNavigate = window.openerx.onAutomationNavigate((automationId) => {
      navigate(`/automations?automation=${encodeURIComponent(automationId)}`);
    });
    const unsubscribeMemory = window.openerx.onAutomaticMemoryCreated((event) => {
      setAutomaticMemoryNotice(event);
      setMemoryUndoError(null);
      void queryClient.invalidateQueries({ queryKey: ["memory", "list"] });
    });
    const unsubscribeMemoryNavigate = window.openerx.onMemoryNavigate((memoryId) => {
      navigate(`/settings/account?section=memory&memory=${encodeURIComponent(memoryId)}`);
    });
    return () => {
      unsubscribeRun();
      unsubscribeNavigate();
      unsubscribeMemory();
      unsubscribeMemoryNavigate();
    };
  }, [navigate, queryClient]);
  const undoAutomaticMemories = async (): Promise<void> => {
    const notice = automaticMemoryNotice;
    if (!notice || memoryUndoPending) return;
    setMemoryUndoPending(true);
    setMemoryUndoError(null);
    try {
      await Promise.all(
        notice.memories.map((memory) =>
          window.openerx.deleteMemory({
            memoryId: memory.id,
            idempotencyKey: `memory-notification-undo:${notice.eventId}:${memory.id}`,
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["memory", "list"] });
      setAutomaticMemoryNotice(null);
    } catch (error) {
      setMemoryUndoError(userFacingError(error, "撤销自动记忆失败，请在记忆设置中重试。"));
    } finally {
      setMemoryUndoPending(false);
    }
  };
  const toggleContext = (): void => {
    if (!contextOpen && document.activeElement instanceof HTMLElement) {
      contextReturnFocus.current = document.activeElement;
    }
    setContextOpen((current) => !current);
  };
  const closeContext = (): void => {
    setContextOpen(false);
    const returnTarget = contextReturnFocus.current;
    window.requestAnimationFrame(() => {
      if (returnTarget?.isConnected) returnTarget.focus();
    });
  };

  useEffect(() => {
    const applyEvent = (event: ChatEvent): void => {
      if (event.type === "service.status") {
        return;
      }
      if (
        event.type.startsWith("run.") ||
        event.type.startsWith("tool.") ||
        event.type.startsWith("permission.")
      ) {
        void queryClient.invalidateQueries({ queryKey: ["tools"] });
        void queryClient.invalidateQueries({ queryKey: ["work-items"] });
        void queryClient.invalidateQueries({ queryKey: ["permissions"] });
      }
      if (!event.conversationId) return;
      const conversationId = event.conversationId;
      const previous = sequenceByConversation.current.get(conversationId) ?? 0;
      if (event.sequence > previous + 1) {
        void window.openerx
          .getChatEvents({ conversationId, afterSequence: previous })
          .then((events) => {
            sequenceByConversation.current.set(conversationId, events.at(-1)?.sequence ?? previous);
          });
      } else if (event.sequence > previous) {
        sequenceByConversation.current.set(conversationId, event.sequence);
      }
      if (event.type === "message.delta" && event.payload.message) {
        const streamedMessage = event.payload.message;
        queryClient.setQueryData<ConversationSnapshot>(
          chatKeys.conversation(conversationId),
          (current) => {
            if (!current) return current;
            const index = current.messages.findIndex(({ id }) => id === streamedMessage.id);
            if (index < 0) return current;
            return {
              ...current,
              messages: current.messages.map((message, messageIndex) =>
                messageIndex === index ? streamedMessage : message,
              ),
            };
          },
        );
      } else {
        void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) });
        void queryClient.invalidateQueries({ queryKey: ["chat", "list"] });
        void queryClient.invalidateQueries({ queryKey: ["artifacts"] });
      }
    };
    const unsubscribe = window.openerx.onChatEvent(applyEvent);
    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  return (
    <div
      className={`app-shell ${sidebarOpen ? "" : "sidebar-is-collapsed"} ${contextOpen ? "context-is-open" : ""} ${settingsOpen ? "settings-is-open" : ""}`}
    >
      <button
        type="button"
        className="skip-link"
        onClick={() => document.getElementById("main-content")?.focus()}
      >
        跳到主要内容
      </button>
      {!settingsOpen ? (
        <Sidebar
          onCollapse={() => setSidebarOpen(false)}
          backgroundInert={contextOpen}
          assistantFeatureEnabled={assistantFeatureEnabled}
        />
      ) : null}
      {!settingsOpen && !sidebarOpen ? (
        <button
          type="button"
          className="sidebar-open"
          aria-label="展开侧栏"
          onClick={() => setSidebarOpen(true)}
        >
          <SidebarSimple size={19} />
        </button>
      ) : null}
      <div
        className={`app-main${settingsOpen ? " app-main-settings" : ""}`}
        id="main-content"
        tabIndex={-1}
        inert={contextOpen ? true : undefined}
        aria-hidden={contextOpen || undefined}
      >
        <Routes>
          <Route path="/chat/new" element={<NewChat defaultModelRef={defaultModelRef} />} />
          <Route
            path="/projects/:projectId/new"
            element={<ProjectNewChat defaultModelRef={defaultModelRef} />}
          />
          <Route path="/projects/:projectId" element={<ProjectHome />} />
          <Route
            path="/chat/:conversationId"
            element={<ChatPage contextOpen={contextOpen} onToggleContext={toggleContext} />}
          />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/files" element={<FilesAndArtifacts />} />
          <Route
            path="/tasks"
            element={<Navigate to="/settings/account?section=tools" replace />}
          />
          <Route
            path="/automations"
            element={<AutomationsPage defaultModelRef={defaultModelRef} />}
          />
          <Route
            path="/assistant"
            element={
              assistantFeatureEnabled ? (
                <AssistantPage
                  companionEnabled={assistantCompanionEnabled}
                  onCompanionEnabledChange={setAssistantCompanionEnabled}
                />
              ) : (
                <Navigate to="/chat/new" replace />
              )
            }
          />
          <Route
            path="/assistants"
            element={<Navigate to="/settings/account?section=assistants" replace />}
          />
          <Route path="/settings" element={<Navigate to="/settings/account" replace />} />
          <Route path="/settings/billing" element={<BillingSettings />} />
          <Route
            path="/settings/account"
            element={
              <AccountSettings
                themePreference={themePreference}
                onThemeChange={setThemePreference}
                defaultModelRef={defaultModelRef}
                onDefaultModelChange={setDefaultModelRef}
                onClose={() => navigate(lastNonSettingsLocation.current)}
              />
            }
          />
          <Route path="/settings/*" element={<Placeholder title="设置" />} />
          <Route path="*" element={<Navigate to="/chat/new" replace />} />
        </Routes>
      </div>
      {assistantFeatureEnabled &&
      assistantCompanionEnabled &&
      !settingsOpen &&
      !contextOpen &&
      !location.pathname.startsWith("/assistant") ? (
        <AssistantCompanion onOpen={() => navigate("/assistant")} />
      ) : null}
      <DesktopControlBar />
      {automaticMemoryNotice ? (
        <aside className="memory-created-notice" role="status" aria-live="polite">
          <Brain size={21} aria-hidden="true" />
          <div>
            <strong>已生成长期记忆</strong>
            <span>后台新增 {automaticMemoryNotice.memories.length} 条，可随时查看或撤销。</span>
            {memoryUndoError ? <small>{memoryUndoError}</small> : null}
          </div>
          <button
            type="button"
            onClick={() => {
              const memoryId = automaticMemoryNotice.memories[0]?.id;
              navigate(
                `/settings/account?section=memory${memoryId ? `&memory=${encodeURIComponent(memoryId)}` : ""}`,
              );
            }}
          >
            查看
          </button>
          <button
            type="button"
            disabled={memoryUndoPending}
            onClick={() => void undoAutomaticMemories()}
          >
            {memoryUndoPending ? "撤销中…" : "撤销"}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭自动记忆通知"
            onClick={() => setAutomaticMemoryNotice(null)}
          >
            <X size={16} />
          </button>
        </aside>
      ) : null}
      {contextOpen && contextConversationId ? (
        <>
          <button
            type="button"
            className="context-backdrop"
            aria-label="关闭上下文"
            tabIndex={-1}
            onClick={closeContext}
          />
          <ContextDock conversationId={contextConversationId} onClose={closeContext} />
        </>
      ) : null}
    </div>
  );
}
