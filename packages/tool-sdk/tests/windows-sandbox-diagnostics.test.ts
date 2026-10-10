import { describe, expect, it } from "vitest";
import { resolveWindowsPowerShellCommand } from "../src/windows-powershell";
import { sandboxDiagnosticText, windowsSandboxFailure } from "../src/windows-sandbox-diagnostics";

describe("Windows sandbox diagnostics", () => {
  it.each([
    [
      "MXC is prohibited by windows.allow_mxc in requirements.toml",
      "SHELL_WINDOWS_CODEX_POLICY_DENIED",
    ],
    ["Windows error 1385: logon type denied", "SHELL_WINDOWS_CODEX_LOGON_DENIED"],
    ["MXC requires allow_local_binding=true", "SHELL_WINDOWS_CODEX_NETWORK_POLICY_CONFLICT"],
    ["probe timed out", "SHELL_WINDOWS_CODEX_PROBE_TIMEOUT"],
  ])("preserves the startup failure category: %s", (message, code) => {
    expect(
      windowsSandboxFailure(new Error(message), "compatibility", "mxc").diagnostic,
    ).toMatchObject({ stage: "compatibility", backend: "mxc", code, message });
  });
  it("redacts credentials and bounds untrusted diagnostic messages", () => {
    const text = sandboxDiagnosticText(
      `Bearer abc.def password=testing api_key=private https://name:secret@example.test/\n${"x".repeat(2000)}`,
    );
    expect(text).not.toMatch(/abc\.def|testing|private|name:secret|\n/);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(sandboxDiagnosticText('{"password":"testing","api_key":"private"}')).not.toMatch(
      /testing|private/,
    );
  });
  it("only wraps the explicit PowerShell entrypoint and retains the script literally", () => {
    const raw = ["/d", "/c", "echo 中文 & echo %PATH%"];
    expect(resolveWindowsPowerShellCommand("cmd.exe", raw)).toEqual({
      command: "cmd.exe",
      args: raw,
    });
    const script = "Write-Output '中文🙂'; exit 7";
    const result = resolveWindowsPowerShellCommand("openerx-powershell", [script]);
    expect(result.command).toMatch(/powershell\.exe$/u);
    expect(result.args.slice(0, 6)).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-OutputFormat",
      "Text",
      "-EncodedCommand",
    ]);
    expect(Buffer.from(result.args[6] ?? "", "base64").toString("utf16le")).toContain(
      `$OutputEncoding = $openerxUtf8\n${script}`,
    );
    expect(Buffer.from(result.args[6] ?? "", "base64").toString("utf16le")).toContain(
      "$ProgressPreference = 'SilentlyContinue'",
    );
    expect(() => resolveWindowsPowerShellCommand("openerx-powershell", [])).toThrow(
      "SHELL_POWERSHELL_SCRIPT_REQUIRED",
    );
  });
});
