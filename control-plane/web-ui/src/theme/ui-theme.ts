import { theme } from "ant-design-vue";
import type { CSSProperties } from "vue";

export const palette = {
  primary: "#4b74d1",
  primaryHover: "#5c84de",
  primaryActive: "#365cab",
  success: "#4f7d62",
  warning: "#c28a3b",
  error: "#bf5a4f",
  accentCopper: "#b89d7d",
  accentCopperSoft: "#d9c7b1",
  accentCopperMute: "#eadfce",
  accentPanel: "#efe1d2",
  accentFill: "#efe4d6",
  accentFillSoft: "#f5ede3",
  layoutBg: "#f6f1ea",
  containerBg: "#fffaf4",
  containerBgAlt: "#fffdf9",
  sectionBg: "#f8f2e9",
  canvasBg: "#f6ecdf",
  siderBg: "#1f2329",
  siderBorder: "#3a332c",
  siderText: "#d7cec4",
  siderMuted: "#b8b0a7",
  text: "#302419",
  textStrong: "#2f2418",
  textMuted: "#6d5842",
  textSubtle: "#7b6650",
  textTag: "#5f4b39",
  spotlightBg: "#2b2e34",
  shadow: "0 10px 28px rgba(92, 59, 24, 0.08)",
  shadowSoft: "0 10px 24px rgba(92, 59, 24, 0.06)",
  shadowStrong: "0 12px 28px rgba(92, 59, 24, 0.08)",
  shadowLogin: "0 18px 42px rgba(92, 59, 24, 0.12)",
} as const;

export const appTheme = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: palette.primary,
    colorSuccess: palette.success,
    colorWarning: palette.warning,
    colorError: palette.error,
    colorInfo: palette.primary,
    colorLink: palette.primary,
    colorBgLayout: palette.layoutBg,
    colorBgContainer: palette.containerBg,
    colorBgElevated: palette.containerBg,
    colorBgSpotlight: palette.spotlightBg,
    colorBorder: palette.accentCopperSoft,
    colorBorderSecondary: palette.accentCopperMute,
    colorText: palette.text,
    colorTextSecondary: palette.textMuted,
    colorTextTertiary: "#8c745b",
    colorFillSecondary: palette.accentFill,
    colorFillTertiary: palette.accentFillSoft,
    controlItemBgHover: "#f1e6d8",
    controlItemBgActive: "#e9d9c7",
    controlOutline: "rgba(75, 116, 209, 0.16)",
    boxShadowSecondary: palette.shadow,
    fontSize: 14,
    borderRadius: 10,
    borderRadiusLG: 14,
  },
  components: {
    Menu: {
      darkItemBg: palette.siderBg,
      darkSubMenuItemBg: palette.siderBg,
      darkItemColor: palette.siderText,
      darkItemHoverBg: "#2d323a",
      darkItemHoverColor: "#ffffff",
      darkItemSelectedBg: palette.primary,
      darkItemSelectedColor: "#ffffff",
      itemBorderRadius: 12,
      itemMarginInline: 8,
      itemMarginBlock: 6,
    },
    Button: {
      primaryShadow: "0 8px 18px rgba(75, 116, 209, 0.24)",
      defaultShadow: "none",
      dangerShadow: "none",
      defaultBorderColor: palette.accentCopper,
      defaultColor: "#3d2d1e",
      defaultBg: palette.containerBg,
      defaultHoverBg: palette.containerBgAlt,
      defaultHoverColor: palette.primary,
      defaultHoverBorderColor: palette.primary,
      defaultActiveBg: "#f3e8d9",
      defaultActiveColor: palette.primaryActive,
      defaultActiveBorderColor: palette.primaryActive,
      colorPrimaryHover: palette.primaryHover,
      colorPrimaryActive: palette.primaryActive,
    },
    Input: {
      activeBorderColor: palette.primary,
      hoverBorderColor: palette.accentCopper,
      activeShadow: "0 0 0 3px rgba(75, 116, 209, 0.14)",
    },
    Radio: {
      buttonSolidCheckedBg: palette.primary,
      buttonSolidCheckedHoverBg: palette.primaryHover,
      buttonSolidCheckedActiveBg: palette.primaryActive,
      buttonBg: palette.containerBg,
      buttonCheckedBg: "#e9edf9",
      buttonColor: "#3d2d1e",
      buttonCheckedBgDisabled: "#ece5db",
    },
    Tabs: {
      itemColor: palette.textMuted,
      itemHoverColor: palette.primaryActive,
      itemSelectedColor: palette.textStrong,
      inkBarColor: palette.primary,
      cardBg: palette.accentFill,
    },
    Card: {
      headerBg: palette.containerBg,
    },
    Modal: {
      contentBg: palette.containerBg,
      headerBg: palette.containerBg,
      footerBg: palette.containerBg,
    },
    Tag: {
      defaultBg: "#f1e7da",
      defaultColor: palette.textTag,
    },
  },
};

export const layoutThemeStyles = {
  sider: {
    background: palette.siderBg,
    borderRight: `1px solid ${palette.siderBorder}`,
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  logoWrap: {
    padding: "16px 24px",
    borderBottom: `1px solid ${palette.siderBorder}`,
  } satisfies CSSProperties,
  logoHeader: {
    gap: "8px",
  } satisfies CSSProperties,
  logoCompactBadge: {
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(110, 149, 235, 0.14)",
    color: "#8eb0ff",
    fontSize: "14px",
    fontWeight: 700,
    letterSpacing: "0.08em",
  } satisfies CSSProperties,
  logoTitle: {
    color: "#6e95eb",
    fontSize: "20px",
    margin: 0,
  } satisfies CSSProperties,
  logoSubtitle: {
    color: palette.siderMuted,
    fontSize: "12px",
    margin: "4px 0 0",
  } satisfies CSSProperties,
  footer: {
    padding: "12px 16px",
    borderTop: `1px solid ${palette.siderBorder}`,
    marginTop: "auto",
  } satisfies CSSProperties,
  footerUser: {
    color: palette.siderText,
    fontSize: "13px",
  } satisfies CSSProperties,
  footerStatusRow: {
    marginBottom: "8px",
    minHeight: "22px",
  } satisfies CSSProperties,
  footerAction: {
    color: "#e7ddd2",
  } satisfies CSSProperties,
  footerActionCollapsed: {
    color: "#e7ddd2",
    width: "100%",
    display: "flex",
    justifyContent: "center",
  } satisfies CSSProperties,
  siderToggle: {
    color: "#e7ddd2",
    paddingInline: "6px",
  } satisfies CSSProperties,
  content: {
    overflow: "auto",
  } satisfies CSSProperties,
  passwordHint: {
    color: palette.textMuted,
    fontSize: "12px",
    marginTop: "4px",
  } satisfies CSSProperties,
  projectSwitcherWrap: {
    padding: "8px 16px",
    borderBottom: `1px solid ${palette.siderBorder}`,
  } satisfies CSSProperties,
};

export const loginThemeStyles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(160deg, #f5efe7 0%, #ebe1d4 45%, #ddd0bf 100%)",
  } satisfies CSSProperties,
  card: {
    width: "380px",
    background: palette.containerBg,
    borderColor: palette.accentCopperSoft,
    boxShadow: palette.shadowLogin,
  } satisfies CSSProperties,
  title: {
    color: palette.textStrong,
    fontSize: "24px",
    margin: "0 0 4px",
  } satisfies CSSProperties,
  subtitle: {
    color: palette.textMuted,
    fontSize: "13px",
    margin: "0 0 32px",
  } satisfies CSSProperties,
};

/** @deprecated Workbench now uses scoped CSS in TaskWorkbench.vue. Kept only for backward compat. */
export const workbenchThemeStyles = {
  page: {
    padding: "24px",
    background: palette.layoutBg,
    minHeight: "100%",
    boxSizing: "border-box",
  } satisfies CSSProperties,
  header: {
    marginBottom: "16px",
    gap: "16px",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: {
    margin: 0,
    color: palette.textStrong,
  } satisfies CSSProperties,
  pickerSelect: {
    width: "280px",
  } satisfies CSSProperties,
  shellCard: {
    borderColor: palette.accentCopperSoft,
    background: palette.containerBg,
    boxShadow: palette.shadowSoft,
  } satisfies CSSProperties,
  shellBody: {
    paddingBottom: "12px",
    display: "flex",
    flexDirection: "column",
    minHeight: "calc(100dvh - 210px)",
  } satisfies CSSProperties,
  tabLabel: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    maxWidth: "260px",
    padding: "2px 0",
    overflow: "hidden",
  } satisfies CSSProperties,
  attentionTag: {
    marginInlineStart: 0,
  } satisfies CSSProperties,
  pane: {
    display: "flex",
    flexDirection: "column",
    border: `1px solid ${palette.accentCopperSoft}`,
    borderRadius: "10px",
    overflow: "hidden",
    background: palette.containerBgAlt,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
  } satisfies CSSProperties,
  paneHeader: {
    padding: "12px 16px",
    borderBottom: `1px solid ${palette.accentCopperSoft}`,
    background: palette.accentPanel,
    color: "#46311f",
  } satisfies CSSProperties,
  paneTitle: {
    color: "#46311f",
    fontWeight: 600,
  } satisfies CSSProperties,
  secondaryHeader: {
    gap: "12px",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  secondarySelect: {
    minWidth: "220px",
    maxWidth: "240px",
  } satisfies CSSProperties,
  emptyPane: {
    padding: "48px 24px",
  } satisfies CSSProperties,
  primaryFrame: {
    display: "block",
    width: "100%",
    height: "clamp(520px, calc(100dvh - 250px), 1200px)",
    border: 0,
  } satisfies CSSProperties,
  splitFrame: {
    display: "block",
    width: "100%",
    height: "clamp(420px, calc(100dvh - 280px), 1000px)",
    border: 0,
  } satisfies CSSProperties,
};

export const taskDetailThemeStyles = {
  page: {
    padding: "24px",
    background: palette.layoutBg,
    minHeight: "100%",
    boxSizing: "border-box",
  } satisfies CSSProperties,
  header: {
    marginBottom: "16px",
    gap: "16px",
  } satisfies CSSProperties,
  title: {
    margin: 0,
    color: palette.text,
  } satisfies CSSProperties,
  statusTags: {
    marginTop: "8px",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  sessionsCard: {
    background: palette.containerBg,
    borderColor: palette.accentCopperSoft,
    boxShadow: palette.shadowSoft,
  } satisfies CSSProperties,
  sessionsBody: {
    padding: "12px",
  } satisfies CSSProperties,
  compactEmptyState: {
    padding: "20px 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } satisfies CSSProperties,
  compactEmptyText: {
    fontSize: "12px",
    color: palette.textMuted,
  } satisfies CSSProperties,
  sessionsList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    maxHeight: "calc(100vh - 220px)",
    overflowY: "auto",
  } satisfies CSSProperties,
  sessionHeader: {
    gap: "8px",
  } satisfies CSSProperties,
  sessionMetaBlock: {
    minWidth: 0,
    flex: 1,
  } satisfies CSSProperties,
  sessionTitle: {
    fontWeight: 600,
    lineHeight: 1.4,
    wordBreak: "break-word",
  } satisfies CSSProperties,
  sessionExcerptWrap: {
    marginTop: "8px",
  } satisfies CSSProperties,
  sessionExcerpt: {
    margin: 0,
    fontSize: "12px",
  } satisfies CSSProperties,
  mainCard: {
    background: palette.containerBg,
    borderColor: palette.accentCopperSoft,
    boxShadow: palette.shadowStrong,
  } satisfies CSSProperties,
  mainBody: {
    padding: "0",
  } satisfies CSSProperties,
  mainHeader: {
    gap: "12px",
  } satisfies CSSProperties,
  mainHeaderTitle: {
    fontWeight: 600,
  } satisfies CSSProperties,
  selectedSessionHint: {
    fontSize: "12px",
    color: "#7a6650",
  } satisfies CSSProperties,
  messagesPane: {
    height: "calc(100vh - 360px)",
    minHeight: "420px",
    overflowY: "auto",
    padding: "16px",
    background: "#f7efe5",
  } satisfies CSSProperties,
  compactMessagesPane: {
    minHeight: "112px",
    padding: "12px 16px",
    background: "#f7efe5",
  } satisfies CSSProperties,
  compactMainEmptyState: {
    minHeight: "72px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  } satisfies CSSProperties,
  compactMainEmptyText: {
    fontSize: "13px",
    color: palette.textMuted,
  } satisfies CSSProperties,
  messageList: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  } satisfies CSSProperties,
  messageHeader: {
    marginBottom: "8px",
    gap: "12px",
  } satisfies CSSProperties,
  messagePre: {
    margin: 0,
    whiteSpace: "normal",
    wordBreak: "break-word",
    lineHeight: 1.42,
    fontFamily: "inherit",
    fontSize: "14px",
  } satisfies CSSProperties,
  sessionMeta: {
    fontSize: "12px",
    color: palette.textSubtle,
  } satisfies CSSProperties,
  sessionSummary: {
    display: "block",
    marginTop: "8px",
    fontSize: "12px",
    color: palette.textSubtle,
  } satisfies CSSProperties,
  itemTime: {
    fontSize: "12px",
    color: palette.textSubtle,
  } satisfies CSSProperties,
  toolSummaryList: {
    marginTop: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  } satisfies CSSProperties,
  toolCallCard: {
    padding: "10px 12px",
    borderRadius: "10px",
    background: palette.accentFill,
    border: "1px solid #dcc9b3",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  } satisfies CSSProperties,
  toolCallHeader: {
    gap: "8px",
  } satisfies CSSProperties,
  toolCallActions: {
    flexShrink: 0,
  } satisfies CSSProperties,
  toolCallTitleGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  } satisfies CSSProperties,
  toolCallHeadline: {
    fontSize: "12px",
    color: palette.textMuted,
    wordBreak: "break-word",
  } satisfies CSSProperties,
  toolCallMeta: {
    fontSize: "12px",
    color: "#5a4633",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  toolCallSection: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  } satisfies CSSProperties,
  toolCallSectionLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: palette.textMuted,
  } satisfies CSSProperties,
  toolCallCode: {
    margin: 0,
    padding: "8px 10px",
    borderRadius: "8px",
    background: "rgba(255, 250, 244, 0.8)",
    border: `1px solid ${palette.accentCopperSoft}`,
    fontSize: "12px",
    lineHeight: 1.55,
    color: palette.textStrong,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
  } satisfies CSSProperties,
  toolCallCommand: {
    margin: 0,
    padding: "8px 10px",
    borderRadius: "8px",
    background: "#2b2e34",
    border: `1px solid ${palette.siderBorder}`,
    fontSize: "12px",
    lineHeight: 1.55,
    color: "#f3eadf",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
  } satisfies CSSProperties,
  toolCallPath: {
    margin: 0,
    padding: "8px 10px",
    borderRadius: "8px",
    background: "rgba(255,255,255,0.55)",
    border: `1px dashed ${palette.accentCopper}`,
    fontSize: "12px",
    lineHeight: 1.55,
    color: palette.textStrong,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
  } satisfies CSSProperties,
  toolCallMoreHint: {
    fontSize: "12px",
    color: palette.textSubtle,
  } satisfies CSSProperties,
  composer: {
    position: "sticky",
    bottom: 0,
    zIndex: 2,
    padding: "16px",
    borderTop: `1px solid ${palette.accentCopperSoft}`,
    background: "#fbf6ef",
  } satisfies CSSProperties,
  composerFormItem: {
    marginBottom: "10px",
  } satisfies CSSProperties,
  compactComposer: {
    position: "sticky",
    bottom: 0,
    zIndex: 2,
    padding: "12px 16px",
    borderTop: `1px solid ${palette.accentCopperSoft}`,
    background: "#fbf6ef",
  } satisfies CSSProperties,
  compactComposerFormItem: {
    marginBottom: "6px",
  } satisfies CSSProperties,
  composerFooter: {
    gap: "12px",
  } satisfies CSSProperties,
  composerHint: {
    fontSize: "12px",
    color: palette.textMuted,
  } satisfies CSSProperties,
  sidebar: {
    width: "100%",
  } satisfies CSSProperties,
  graphCard: {
    background: palette.containerBg,
    borderColor: palette.accentCopperSoft,
    boxShadow: palette.shadowSoft,
  } satisfies CSSProperties,
  graphWrap: {
    height: "260px",
  } satisfies CSSProperties,
  collapse: {
    background: palette.sectionBg,
  } satisfies CSSProperties,
  governanceViolations: {
    marginTop: "12px",
  } satisfies CSSProperties,
  governanceList: {
    marginTop: "8px",
  } satisfies CSSProperties,
  pipelineOutputs: {
    marginTop: "12px",
  } satisfies CSSProperties,
  pipelineOutputPre: {
    whiteSpace: "pre-wrap",
    fontSize: "12px",
    maxHeight: "220px",
    overflow: "auto",
  } satisfies CSSProperties,
  hookResult: {
    margin: 0,
    fontSize: "12px",
  } satisfies CSSProperties,
  agentsList: {
    width: "100%",
  } satisfies CSSProperties,
};

export function buildTaskDetailSessionCardStyle(selected: boolean): CSSProperties {
  return {
    cursor: "pointer",
    padding: "12px",
    borderRadius: "10px",
    border: selected ? "1px solid #9a6731" : `1px solid ${palette.accentCopperSoft}`,
    background: selected ? "#f2e3d1" : palette.containerBg,
    boxShadow: selected ? "0 0 0 2px rgba(154,103,49,0.12)" : "none",
    transition: "all 0.2s ease",
  };
}

export function buildTaskDetailMessageCardStyle(role: string): CSSProperties {
  const background = role === "assistant" ? "#fff5e6" : role === "user" ? "#edf5ef" : "#f3ece3";
  const border = role === "assistant" ? "#dfb979" : role === "user" ? "#a9c3b0" : "#d6c4af";
  const accent = role === "assistant" ? "#b87428" : role === "user" ? "#557a64" : "#8b7862";

  return {
    padding: "14px 16px",
    borderRadius: "12px",
    background,
    border: `1px solid ${border}`,
    boxShadow: "0 6px 18px rgba(92, 59, 24, 0.06)",
    borderLeft: `4px solid ${accent}`,
  };
}

export const taskGraphTheme = {
  canvas: {
    height: "100%",
    background: palette.canvasBg,
    borderRadius: "8px",
  } satisfies CSSProperties,
  backgroundColor: "#d8c5af",
  statusColors: {
    pending: "#8a745f",
    blocked: "#8a61b8",
    in_progress: palette.primary,
    running: palette.primary,
    completed: palette.success,
    failed: palette.error,
    stopped: "#8a745f",
    paused: palette.warning,
    waiting_approval: "#c86f35",
    cancelled: "#8a745f",
  } as Record<string, string>,
  edgeStroke: "#b89d7d",
};

export function buildTaskGraphNodeStyle(status: string): CSSProperties {
  return {
    background: palette.containerBg,
    border: `2px solid ${taskGraphTheme.statusColors[status] || "#8a745f"}`,
    borderRadius: "8px",
    padding: "8px 12px",
    color: palette.text,
    textAlign: "center",
    minWidth: "140px",
    boxShadow: "0 6px 14px rgba(92, 59, 24, 0.06)",
  };
}

export const tasksThemeStyles = {
  credentialSummary: {
    marginTop: "8px",
    padding: "8px 12px",
    background: "#f7efe5",
    borderRadius: "8px",
    border: `1px solid ${palette.accentCopperSoft}`,
  } satisfies CSSProperties,
  credentialSummaryText: {
    fontSize: "12px",
    color: palette.textMuted,
  } satisfies CSSProperties,
  templateManager: {
    marginTop: "8px",
    padding: "8px",
    border: `1px solid ${palette.accentCopperSoft}`,
    borderRadius: "8px",
    background: palette.containerBg,
  } satisfies CSSProperties,
};
