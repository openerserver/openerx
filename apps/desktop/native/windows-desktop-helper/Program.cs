using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace OpenErx.Desktop;

internal static class Program
{
    internal const string Version = "desktop_control_v2";
    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal static void Write(object value)
    {
        Console.WriteLine(JsonSerializer.Serialize(value, Json));
        Console.Out.Flush();
    }

    [MTAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length != 2 || !int.TryParse(args[1], out var parentId) || parentId <= 0) return 2;
        // Observation requests and the input monitor remain isolated. Interactive
        // requests share one MTA process so activation and input have one owner.
        using var parent = Process.GetProcessById(parentId);
        var parentStart = parent.StartTime.ToUniversalTime();
        using var watchdog = new System.Threading.Timer(_ =>
        {
            try { if (parent.HasExited || parent.StartTime.ToUniversalTime() != parentStart) Environment.Exit(3); }
            catch { Environment.Exit(3); }
        }, null, 500, 500);
        if (args[0] == "--monitor") return InputMonitor.Run();
        if (args[0] == "--session")
        {
            while (Console.In.Peek() != -1)
            {
                var result = Request(true);
                if (result != 0) return result;
            }
            return 0;
        }
        if (args[0] != "--request") return 2;
        return Request(false);
    }

    private static int Request(bool session)
    {
        string? id = null;
        try
        {
            // Bound before parsing, including a malicious/incorrect local caller.
            var line = new StringBuilder();
            int c;
            while ((c = Console.In.Read()) != -1 && c != '\n')
            {
                if (line.Length >= 256 * 1024) throw new InvalidOperationException("DESKTOP_REQUEST_TOO_LARGE");
                line.Append((char)c);
            }
            using var document = JsonDocument.Parse(line.ToString());
            var request = document.RootElement;
            id = request.GetProperty("id").GetString();
            if (!Guid.TryParse(id, out _) || request.GetProperty("jsonrpc").GetString() != "2.0") throw new InvalidOperationException("DESKTOP_PROTOCOL_INVALID");
            var method = request.GetProperty("method").GetString()!;
            if (session && method is not ("focus" or "act")) throw new InvalidOperationException("DESKTOP_METHOD_UNSUPPORTED");
            var result = Automation.Execute(method, request.GetProperty("params"));
            Write(new { jsonrpc = "2.0", id, result });
            return 0;
        }
        catch (Exception ex)
        {
            var code = Regex.IsMatch(ex.Message, "^DESKTOP_[A-Z_]+$") ? ex.Message : "DESKTOP_NATIVE_FAILED";
            Write(new { jsonrpc = "2.0", id, error = new { code = -32000, message = code } });
            return 1;
        }
    }
}
