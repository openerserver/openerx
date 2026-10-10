import path from "node:path";
import type { ManagedNodeRuntime } from "@openerx/contracts";
import { assertManagedNodeRuntime } from "./managed-node-runtime";

/**
 * MXC cannot initially launch this external executable on some Windows hosts.
 * A trusted in-container OS process starts the exact verified Node executable.
 * Model arguments remain data; neither a command shell nor Invoke-Expression is used.
 */
export function windowsManagedNodeLaunch(
  runtime: ManagedNodeRuntime | undefined,
  command: string,
  args: readonly string[],
): { command: string; args: string[] } {
  if (!runtime || command !== runtime.nodeExecutable) return { command, args: [...args] };
  assertManagedNodeRuntime(runtime);
  const payload = Buffer.from(JSON.stringify({ command, args }), "utf8").toString("base64");
  const script = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System.IO;
using System.Threading.Tasks;
public static class OpenerxManagedNodeBytePump {
  public static async Task Copy(Stream source, Stream destination, bool closeOnEof) {
    byte[] buffer = new byte[8192];
    int count;
    while ((count = await source.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) > 0) {
      await destination.WriteAsync(buffer, 0, count).ConfigureAwait(false);
      await destination.FlushAsync().ConfigureAwait(false);
    }
    if (closeOnEof) destination.Close();
  }
}
'@
function Quote-Crt([string] $value) {
  $quoted = New-Object System.Text.StringBuilder
  [void] $quoted.Append('"')
  $slashes = 0
  foreach ($character in $value.ToCharArray()) {
    if ($character -eq [char]92) { $slashes++; continue }
    if ($character -eq [char]34) {
      [void] $quoted.Append(('\\' * (2 * $slashes + 1)))
      [void] $quoted.Append('"')
    } else {
      if ($slashes -gt 0) { [void] $quoted.Append(('\\' * $slashes)) }
      [void] $quoted.Append($character)
    }
    $slashes = 0
  }
  if ($slashes -gt 0) { [void] $quoted.Append(('\\' * (2 * $slashes))) }
  [void] $quoted.Append('"')
  return $quoted.ToString()
}
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $payload.command
$start.Arguments = ((@($payload.args) | ForEach-Object { Quote-Crt ([string] $_) }) -join ' ')
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.WorkingDirectory = [Environment]::CurrentDirectory
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$child = New-Object System.Diagnostics.Process
$child.StartInfo = $start
try {
  if (-not $child.Start()) { throw 'MANAGED_NODE_LAUNCH_FAILED' }
  $stdout = [OpenerxManagedNodeBytePump]::Copy($child.StandardOutput.BaseStream, [Console]::OpenStandardOutput(), $false)
  $stderr = [OpenerxManagedNodeBytePump]::Copy($child.StandardError.BaseStream, [Console]::OpenStandardError(), $false)
  $stdin = [OpenerxManagedNodeBytePump]::Copy([Console]::OpenStandardInput(), $child.StandardInput.BaseStream, $true)
  while (-not $child.WaitForExit(25)) {
    if ($stdin.IsFaulted) { [void] $stdin.Exception }
  }
  if ($stdin.IsFaulted) { [void] $stdin.Exception }
  $code = $child.ExitCode
  [void] [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]] @($stdout, $stderr), 2000)
  if ($stdout.IsCompleted) { [void] $stdout.GetAwaiter().GetResult() }
  if ($stderr.IsCompleted) { [void] $stderr.GetAwaiter().GetResult() }
} finally {
  $child.Dispose()
}
exit $code
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  // CreateProcess command lines are limited to 32,767 UTF-16 units.
  if (encoded.length > 30_000) throw new Error("SHELL_MANAGED_NODE_ARGUMENTS_TOO_LONG");
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
      encoded,
    ],
  };
}
