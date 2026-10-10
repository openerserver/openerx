export type WindowsSandboxStage =
  | "discovery"
  | "protocol"
  | "compatibility"
  | "initialize"
  | "readiness"
  | "setup"
  | "command";
export interface WindowsSandboxDiagnostic {
  stage: WindowsSandboxStage;
  backend?: "mxc" | "elevated";
  code: string;
  nativeCode?: string;
  message: string;
}

// Diagnostic text originates in another process, not in a trusted UI string.
export function sandboxDiagnosticText(value: unknown): string {
  let text = typeof value === "string" ? value : "";
  for (const root of [process.env.USERPROFILE, process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (root) text = text.split(root).join("<user>");
  }
  return text
    .replace(/(bearer\s+)[\w.\-/+=]+/giu, "$1<redacted>")
    .replace(
      /((?:token|password|secret|api[_-]?key)["']?\s*[=:]\s*["']?)[^\s,;"'}]+/giu,
      "$1<redacted>",
    )
    .replace(/:\/\/[^\s/@]+:[^\s/@]+@/gu, "://<redacted>@")
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, 1000);
}

export class WindowsSandboxError extends Error {
  constructor(readonly diagnostic: WindowsSandboxDiagnostic) {
    super(diagnostic.code);
    this.name = "WindowsSandboxError";
  }
}

export function windowsSandboxFailure(
  error: unknown,
  stage: WindowsSandboxStage,
  backend?: "mxc" | "elevated",
  fallbackCode = "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE",
): WindowsSandboxError {
  if (error instanceof WindowsSandboxError) return error;
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const message = sandboxDiagnosticText(
    [
      error instanceof Error ? error.message : typeof error === "string" ? error : "",
      typeof record.stderr === "string" ? record.stderr : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  const nativeCode =
    typeof record.code === "string" || typeof record.code === "number"
      ? String(record.code).slice(0, 80)
      : undefined;
  let code = fallbackCode;
  if (/1385|logon type|logon failure|登录类型|登入類型/iu.test(message))
    code = "SHELL_WINDOWS_CODEX_LOGON_DENIED";
  else if (/allow_local_binding|local binding|managed network.*mxc/iu.test(message))
    code = "SHELL_WINDOWS_CODEX_NETWORK_POLICY_CONFLICT";
  else if (
    /allow_mxc|requirements\.toml|managed.*(?:denied|forbid|disallow)|(?:policy|requirement).*(?:block|prohibit|forbid|not allowed|reject)/iu.test(
      message,
    )
  )
    code = "SHELL_WINDOWS_CODEX_POLICY_DENIED";
  else if (
    record.killed === true ||
    nativeCode === "ETIMEDOUT" ||
    /TIMEOUT|timed out/iu.test(message)
  )
    code = "SHELL_WINDOWS_CODEX_PROBE_TIMEOUT";
  else if (/setup.*(?:required|missing|incomplete)|not.*(?:set up|initialized)/iu.test(message))
    code = "SHELL_WINDOWS_CODEX_SETUP_REQUIRED";
  else if (error instanceof Error && /^SHELL_[A-Z_]+$/u.test(error.message)) code = error.message;
  return new WindowsSandboxError({
    stage,
    ...(backend ? { backend } : {}),
    code,
    ...(nativeCode ? { nativeCode } : {}),
    message,
  });
}

export function windowsSandboxDiagnosticDetails(diagnostic: WindowsSandboxDiagnostic): string[] {
  return [
    `检查阶段：${diagnostic.stage}${diagnostic.backend ? ` / ${diagnostic.backend}` : ""}`,
    ...(diagnostic.nativeCode ? [`系统错误：${diagnostic.nativeCode}`] : []),
    ...(diagnostic.message && diagnostic.message !== diagnostic.code
      ? [`诊断：${diagnostic.message.slice(0, 190)}`]
      : []),
  ];
}
