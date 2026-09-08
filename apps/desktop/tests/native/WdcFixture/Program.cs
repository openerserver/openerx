using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
using System.Text.Json;
internal static class Program
{
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(nint hwnd, int command);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(nint hwnd, int command);
    [DllImport("user32.dll")] private static extern bool IsWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool PostMessage(nint hwnd, uint message, nint w, nint l);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint hwnd, uint flags);
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [StructLayout(LayoutKind.Sequential)] private struct LastInputInfo { public uint Size; public uint Tick; }
    [STAThread] private static void Main(string[] args)
    {
        if (args.Length != 2) return;
        ApplicationConfiguration.Initialize();
        if (args[0] is "--minimize-owned-window" or "--owned-window-state")
        {
            using var data = JsonDocument.Parse(args[1]);
            var target = data.RootElement;
            var hwnd = new nint(long.Parse(target.GetProperty("windowId").GetString()!, System.Globalization.CultureInfo.InvariantCulture));
            if (!IsWindow(hwnd)) { Environment.ExitCode = 1; return; }
            GetWindowThreadProcessId(hwnd, out var pid);
            using var process = Process.GetProcessById((int)pid);
            var started = process.StartTime.ToUniversalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (pid != target.GetProperty("processId").GetInt32() || started != target.GetProperty("processStartTime").GetString())
            { Environment.ExitCode = 1; return; }
            if (args[0] == "--minimize-owned-window")
            {
                // Only arrange the isolated target's minimized precondition;
                // restoration and activation belong to the production helper.
                if (!ShowWindowAsync(hwnd, 6)) Environment.ExitCode = 1;
                return;
            }
            var minimized = IsIconic(hwnd);
            var visible = IsWindowVisible(hwnd);
            GetWindowThreadProcessId(hwnd, out var currentPid);
            if (!IsWindow(hwnd) || currentPid != pid) { Environment.ExitCode = 1; return; }
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                windowId = hwnd.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),
                processId = (int)pid,
                processStartTime = started,
                minimized,
                visible,
            }));
            return;
        }
        if (args[0] == "--foreground-state")
        {
            // Independent read-only evidence: never activate a window or grant
            // foreground permission on behalf of the implementation under test.
            var hwnd = GetAncestor(GetForegroundWindow(), 2);
            // Windows can have no foreground window. Record that state rather
            // than inventing an identity; post-focus assertions still require one.
            if (hwnd == 0) { Console.WriteLine("null"); return; }
            GetWindowThreadProcessId(hwnd, out var pid);
            using var process = Process.GetProcessById((int)pid);
            var started = process.StartTime.ToUniversalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
            GetWindowThreadProcessId(hwnd, out var currentPid);
            if (currentPid != pid || GetAncestor(GetForegroundWindow(), 2) != hwnd)
            { Console.Error.WriteLine("WDC_FOREGROUND_CHANGED_DURING_READ"); Environment.ExitCode = 1; return; }
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                windowId = hwnd.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),
                processId = (int)pid,
                processStartTime = started,
            }));
            return;
        }
        if (args[0] == "--wait-owned-foreground")
        {
            // The user selects the dedicated test window. Only observe here;
            // never synthesize input or attempt to take foreground permission.
            using var data = JsonDocument.Parse(args[1]);
            var target = data.RootElement;
            var hwnd = new nint(long.Parse(target.GetProperty("windowId").GetString()!));
            var watch = Stopwatch.StartNew();
            long? readySince = null;
            while (watch.Elapsed < TimeSpan.FromSeconds(120))
            {
                GetWindowThreadProcessId(hwnd, out var pid);
                if (pid != target.GetProperty("processId").GetInt32()) break;
                using var process = Process.GetProcessById((int)pid);
                if (process.StartTime.ToUniversalTime().Ticks.ToString() != target.GetProperty("processStartTime").GetString()) break;
                var input = new LastInputInfo { Size = (uint)Marshal.SizeOf<LastInputInfo>() };
                var idle = GetLastInputInfo(ref input) && unchecked((uint)Environment.TickCount - input.Tick) >= 1500;
                if (GetAncestor(GetForegroundWindow(), 2) == hwnd && idle)
                {
                    readySince ??= watch.ElapsedMilliseconds;
                    if (watch.ElapsedMilliseconds - readySince.Value >= 500) return;
                }
                else readySince = null;
                Thread.Sleep(100);
            }
            Environment.ExitCode = 1;
            return;
        }
        if (args[0] == "--close-owned-window")
        {
            using var data = JsonDocument.Parse(args[1]);
            var target = data.RootElement;
            var hwnd = new nint(long.Parse(target.GetProperty("windowId").GetString()!));
            GetWindowThreadProcessId(hwnd, out var pid);
            using var process = Process.GetProcessById((int)pid);
            if (pid == target.GetProperty("processId").GetInt32() && process.StartTime.ToUniversalTime().Ticks.ToString() == target.GetProperty("processStartTime").GetString()) PostMessage(hwnd, 0x10, 0, 0);
            return;
        }
        if (args[0] is "--launch-notepad" or "--launch-calculator")
        {
            using var launcher = new Form { Text = "WDC isolated application launcher", Width = 420, Height = 140, StartPosition = FormStartPosition.CenterScreen };
            launcher.Load += (_, _) => ShowWindow(launcher.Handle, 5);
            launcher.Shown += (_, _) =>
            {
                launcher.Activate(); SetForegroundWindow(launcher.Handle);
                var timer = new System.Windows.Forms.Timer { Interval = 300 };
                timer.Tick += (_, _) =>
                {
                    timer.Stop(); timer.Dispose();
                    var file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), args[0] == "--launch-notepad" ? "notepad.exe" : "calc.exe");
                    var info = new ProcessStartInfo(file) { UseShellExecute = false };
                    if (args[0] == "--launch-notepad") info.ArgumentList.Add(args[1]);
                    Process.Start(info)?.Dispose();
                };
                timer.Start();
            };
            Application.Run(launcher); return;
        }
        using var form = new Form { Text = args[0], Width = 620, Height = 460, StartPosition = FormStartPosition.CenterScreen };
        var editor = new TextBox { AccessibleName = "WDC editor", Multiline = true, Text = "before", Left = 20, Top = 20, Width = 550, Height = 150 };
        var secret = new TextBox { AccessibleName = "Password", UseSystemPasswordChar = true, Text = "WDC_SECRET_CANARY", Left = 20, Top = 185, Width = 240 };
        var save = new Button { AccessibleName = "Save fixture", Text = "保存测试内容", Left = 20, Top = 240, Width = 170 };
        var send = new Button { AccessibleName = "Send", Text = "发送", Left = 220, Top = 240, Width = 100 };
        save.Click += (_, _) => File.WriteAllText(args[1], editor.Text, new UTF8Encoding(false));
        send.Click += (_, _) => File.WriteAllText(args[1] + ".sent", "sent");
        form.Controls.AddRange([editor, secret, save, send]);
        // The test runner hides the dotnet console; explicitly show only this fixture.
        form.Load += (_, _) => ShowWindow(form.Handle, 5);
        form.Shown += (_, _) => { form.Activate(); SetForegroundWindow(form.Handle); editor.Focus(); };
        Application.Run(form);
    }
}
