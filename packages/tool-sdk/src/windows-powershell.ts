import path from "node:path";

/** An explicit script entrypoint. Ordinary executable/argv requests are untouched. */
export function resolveWindowsPowerShellCommand(
  command: string,
  args: readonly string[],
): { command: string; args: string[] } {
  if (command !== "openerx-powershell") return { command, args: [...args] };
  if (args.length !== 1 || args[0]?.includes("\0"))
    throw new Error("SHELL_POWERSHELL_SCRIPT_REQUIRED");
  const bootstrap = [
    "$ProgressPreference = 'SilentlyContinue'",
    "$openerxUtf8 = [System.Text.UTF8Encoding]::new($false)",
    "[Console]::InputEncoding = $openerxUtf8",
    "[Console]::OutputEncoding = $openerxUtf8",
    "$OutputEncoding = $openerxUtf8",
    args[0],
  ].join("\n");
  return {
    command: path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-OutputFormat",
      "Text",
      "-EncodedCommand",
      Buffer.from(bootstrap, "utf16le").toString("base64"),
    ],
  };
}
