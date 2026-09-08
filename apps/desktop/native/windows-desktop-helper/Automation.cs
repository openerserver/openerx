using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Automation;

namespace OpenErx.Desktop;

internal record Bounds(int X, int Y, int Width, int Height);
internal record Target(string ApplicationId, string Application, string ExecutablePath, string ProcessStartTime, int ProcessId, string WindowId, string Title, Bounds Bounds, uint Dpi);
internal record Element(string RuntimeId, string Role, string Name, string? Value, Bounds Bounds, bool Enabled, bool Focused, bool Sensitive, string[] Actions);
internal record Observation(Target Target, Element[] Elements, string Revision, bool Truncated, string? PngBase64, int ImageWidth, int ImageHeight);

internal static class Automation
{
    private static readonly Regex SensitiveName = new("password|密码|验证码|verification code|credit card|银行卡|卡号", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex CommitName = new("send|submit|purchase|pay now|delete|发送|提交|购买|付款|删除", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    internal static object Execute(string method, JsonElement input)
    {
        if (input.GetProperty("contractVersion").GetString() != Program.Version) throw new InvalidOperationException("DESKTOP_PROTOCOL_MISMATCH");
        Native.AssertInteractive();
        return method switch
        {
            "probe" => new { contractVersion = Program.Version, interactive = true, architecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant() },
            "list" => ListWindows(),
            "open" => Open(input.GetProperty("applicationId").GetString()!),
            "observe" => Observe(ReadTarget(input), true),
            "focus" => Focus(ReadTarget(input)),
            "act" => Act(input),
            _ => throw new InvalidOperationException("DESKTOP_METHOD_UNSUPPORTED")
        };
    }

    private static Target ReadTarget(JsonElement input) => input.GetProperty("target").Deserialize<Target>(Program.Json) ?? throw new InvalidOperationException("DESKTOP_TARGET_INVALID");
    private static object Focus(Target target)
    {
        Validate(target, false, true);
        var lastInput = Native.LastInputTime();
        void Check()
        {
            Validate(target, false, true);
            if (Native.LastInputTime() != lastInput) throw new InvalidOperationException("DESKTOP_USER_INPUT_ACTIVE");
            AssertInputReleased();
        }
        bool WaitFor(Func<bool> ready)
        {
            var watch = Stopwatch.StartNew();
            do
            {
                Check();
                if (ready()) return true;
                Thread.Sleep(30);
            } while (watch.ElapsedMilliseconds < 1500);
            Check();
            return ready();
        }
        bool IsForeground() => Native.GetAncestor(Native.GetForegroundWindow(), 2) == Hwnd(target);
        Check();
        if (Native.IsIconic(Hwnd(target)))
        {
            // Restore only minimized windows. Preserve normal/maximized layout.
            Native.ShowWindowAsync(Hwnd(target), 9);
            if (!WaitFor(() => !Native.IsIconic(Hwnd(target)))) throw new InvalidOperationException("DESKTOP_TARGET_NOT_VISIBLE");
        }
        Check();
        if (IsForeground()) return new { focused = true };

        // Activation and input share a process. Use its normal foreground rights
        // without synthesizing Alt/Tab or changing the foreground-lock policy.
        Native.SetForegroundWindow(Hwnd(target));
        if (!WaitFor(IsForeground))
        {
            // Preserve normal/maximized layout. UIA SetFocus is deliberately not
            // used: some providers synthesize unmarked keyboard input.
            Native.ShowWindowAsync(Hwnd(target), 5);
            if (!WaitFor(IsForeground)) throw new InvalidOperationException("DESKTOP_TARGET_NOT_FRONTMOST");
        }
        Check();
        Validate(target, false);
        if (!IsForeground()) throw new InvalidOperationException("DESKTOP_TARGET_NOT_FRONTMOST");
        return new { focused = true };
    }
    private static nint Hwnd(Target target) => new(long.Parse(target.WindowId, System.Globalization.CultureInfo.InvariantCulture));
    private static Bounds WindowBounds(nint hwnd)
    {
        if (!Native.GetWindowRect(hwnd, out var rect)) throw new InvalidOperationException("DESKTOP_TARGET_WINDOW_CHANGED");
        return new(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
    }
    private static Target Describe(nint hwnd, bool allowMinimized = false)
    {
        if (!Native.IsWindow(hwnd) || !Native.IsWindowVisible(hwnd) || (!allowMinimized && Native.IsIconic(hwnd))) throw new InvalidOperationException("DESKTOP_TARGET_NOT_VISIBLE");
        Native.GetWindowThreadProcessId(hwnd, out var pid);
        using var process = Process.GetProcessById((int)pid);
        using var self = Process.GetCurrentProcess();
        if (process.SessionId != self.SessionId || Native.Integrity(process.Handle) > Native.Integrity(self.Handle)) throw new InvalidOperationException("DESKTOP_TARGET_PERMISSION_DENIED");
        var file = Path.GetFullPath(process.MainModule?.FileName ?? throw new InvalidOperationException("DESKTOP_TARGET_IDENTITY_MISSING"));
        var title = new StringBuilder(512);
        Native.GetWindowText(hwnd, title, title.Capacity);
        uint appLength = 512;
        var appName = new StringBuilder(512);
        var packaged = Native.GetApplicationUserModelId(process.Handle, ref appLength, appName) == 0;
        var identity = packaged ? $"appx:{appName}" : file.ToLowerInvariant();
        var bounds = WindowBounds(hwnd);
        if (bounds.Width < 1 || bounds.Height < 1 || bounds.Width > 8192 || bounds.Height > 8192) throw new InvalidOperationException("DESKTOP_CAPTURE_DIMENSIONS_INVALID");
        return new(identity, process.ProcessName, file, process.StartTime.ToUniversalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture), (int)pid, hwnd.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture), title.ToString(), bounds, Native.GetDpiForWindow(hwnd));
    }
    private static Target Validate(Target expected, bool geometry = true, bool allowMinimized = false)
    {
        Native.AssertInteractive();
        var actual = Describe(Hwnd(expected), allowMinimized);
        if (actual.ApplicationId != expected.ApplicationId || actual.ProcessId != expected.ProcessId || actual.ProcessStartTime != expected.ProcessStartTime || !actual.ExecutablePath.Equals(expected.ExecutablePath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("DESKTOP_TARGET_IDENTITY_MISMATCH");
        if (geometry && (actual.Bounds != expected.Bounds || actual.Dpi != expected.Dpi)) throw new InvalidOperationException("DESKTOP_OBSERVATION_STALE");
        return actual;
    }

    private static Target[] ListWindows()
    {
        var windows = new List<Target>();
        Native.EnumWindows((hwnd, _) =>
        {
            if (windows.Count >= 128) return false;
            try
            {
                var target = Describe(hwnd, true);
                if (!string.IsNullOrWhiteSpace(target.Title)) windows.Add(target);
            }
            catch { /* Unavailable/protected windows are not candidates. */ }
            return true;
        }, 0);
        return windows.ToArray();
    }

    private static object Open(string applicationId)
    {
        // An intentionally small launch catalogue. Attaching other running apps is
        // supported independently; no model-supplied path or arguments are executed.
        var name = applicationId switch { "windows:notepad" => "notepad.exe", "windows:calculator" => "calc.exe", _ => throw new InvalidOperationException("DESKTOP_APPLICATION_UNKNOWN") };
        var file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), name);
        using var launched = Process.Start(new ProcessStartInfo(file) { UseShellExecute = false });
        return new { launched = launched != null };
    }

    private static AutomationElement Root(Target target)
    {
        var root = AutomationElement.FromHandle(Hwnd(target));
        if (root.Current.ProcessId != target.ProcessId) throw new InvalidOperationException("DESKTOP_TARGET_IDENTITY_MISMATCH");
        return root;
    }
    private static string RuntimeId(AutomationElement element) => string.Join(".", element.GetRuntimeId());
    private static Bounds BoundsOf(AutomationElement element)
    {
        var rect = element.Current.BoundingRectangle;
        if (rect.IsEmpty || !double.IsFinite(rect.X) || !double.IsFinite(rect.Y) || !double.IsFinite(rect.Width) || !double.IsFinite(rect.Height)) return new(0, 0, 0, 0);
        return new((int)Math.Round(rect.X), (int)Math.Round(rect.Y), (int)Math.Round(rect.Width), (int)Math.Round(rect.Height));
    }
    private static bool Intersects(Bounds a, Bounds b) => a.Width > 0 && a.Height > 0 && a.X < b.X + b.Width && a.Y < b.Y + b.Height && a.X + a.Width > b.X && a.Y + a.Height > b.Y;
    private static string Limited(string? value, int length) => (value ?? "")[..Math.Min(value?.Length ?? 0, length)];

    private static (Element[] Elements, Dictionary<string, AutomationElement> Nodes, bool Truncated) Inspect(Target target)
    {
        var elements = new List<Element>();
        var nodes = new Dictionary<string, AutomationElement>();
        var stopwatch = Stopwatch.StartNew();
        var visited = 0; var truncated = false;
        var walker = TreeWalker.ControlViewWalker;
        void Visit(AutomationElement node, int depth, bool inheritedSensitive)
        {
            if (++visited > 512 || depth > 12 || stopwatch.ElapsedMilliseconds > 2500) { truncated = true; return; }
            var current = node.Current;
            var bounds = BoundsOf(node);
            var sensitive = inheritedSensitive || current.IsPassword || SensitiveName.IsMatch(current.Name ?? "");
            if (!current.IsOffscreen && Intersects(bounds, target.Bounds))
            {
                var actions = new List<string>();
                string? value = null;
                if (!sensitive)
                {
                    if (node.TryGetCurrentPattern(InvokePattern.Pattern, out _)) actions.Add("invoke");
                    if (node.TryGetCurrentPattern(ValuePattern.Pattern, out var vp))
                    {
                        var pattern = (ValuePattern)vp;
                        value = Limited(pattern.Current.Value, 2000);
                        if (!pattern.Current.IsReadOnly) actions.Add("set_value");
                    }
                    if (current.IsKeyboardFocusable && (current.ControlType == ControlType.Edit || current.ControlType == ControlType.Document)) actions.Add("type_text");
                }
                var id = RuntimeId(node);
                elements.Add(new(id, current.ControlType.ProgrammaticName.Replace("ControlType.", ""), sensitive ? "[sensitive]" : Limited(current.Name, 200), value, bounds, current.IsEnabled, current.HasKeyboardFocus, sensitive, actions.ToArray()));
                nodes[id] = node;
            }
            for (var child = walker.GetFirstChild(node); child != null && !truncated; child = walker.GetNextSibling(child)) Visit(child, depth + 1, sensitive);
        }
        Visit(Root(target), 0, false);
        return (elements.ToArray(), nodes, truncated);
    }

    private static string Revision(Target target, Element[] elements) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { target.Bounds, target.Dpi, elements = elements.Select(e => new { e.RuntimeId, e.Role, e.Name, e.Value, e.Bounds, e.Enabled, e.Sensitive, e.Actions }) }, Program.Json))));

    private static Observation Observe(Target expected, bool screenshot)
    {
        var target = Validate(expected, false);
        var inspection = Inspect(target);
        var revision = Revision(target, inspection.Elements);
        string? png = null; var width = 0; var height = 0;
        if (screenshot && !inspection.Truncated)
        {
            (png, width, height) = Capture(target, inspection.Elements);
            var after = Inspect(target);
            if (after.Truncated || Revision(target, after.Elements) != revision) throw new InvalidOperationException("DESKTOP_OBSERVATION_STALE");
        }
        Validate(target);
        return new(target, inspection.Elements, revision, inspection.Truncated, png, width, height);
    }

    private static (string, int, int) Capture(Target target, Element[] elements)
    {
        if ((long)target.Bounds.Width * target.Bounds.Height > 16_000_000) throw new InvalidOperationException("DESKTOP_CAPTURE_DIMENSIONS_INVALID");
        using var bitmap = new Bitmap(target.Bounds.Width, target.Bounds.Height, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            var hdc = graphics.GetHdc();
            try { if (!Native.PrintWindow(Hwnd(target), hdc, 2)) throw new InvalidOperationException("DESKTOP_CAPTURE_UNAVAILABLE"); }
            finally { graphics.ReleaseHdc(hdc); }
            foreach (var e in elements.Where(e => e.Sensitive))
                graphics.FillRectangle(Brushes.Black, e.Bounds.X - target.Bounds.X, e.Bounds.Y - target.Bounds.Y, e.Bounds.Width, e.Bounds.Height);
        }
        var hasPixels = false;
        for (var y = 0; y < bitmap.Height && !hasPixels; y += Math.Max(1, bitmap.Height / 24))
            for (var x = 0; x < bitmap.Width; x += Math.Max(1, bitmap.Width / 24))
            {
                var p = bitmap.GetPixel(x, y);
                if (p.R + p.G + p.B > 12) { hasPixels = true; break; }
            }
        if (!hasPixels) throw new InvalidOperationException("DESKTOP_CAPTURE_UNAVAILABLE");
        var scale = Math.Min(1.0, 1600.0 / Math.Max(bitmap.Width, bitmap.Height));
        using var resized = new Bitmap(bitmap, Math.Max(1, (int)(bitmap.Width * scale)), Math.Max(1, (int)(bitmap.Height * scale)));
        using var stream = new MemoryStream();
        resized.Save(stream, ImageFormat.Png);
        return (Convert.ToBase64String(stream.ToArray()), resized.Width, resized.Height);
    }

    private static void Foreground(Target target)
    {
        Validate(target);
        if (Native.GetAncestor(Native.GetForegroundWindow(), 2) != Hwnd(target)) throw new InvalidOperationException("DESKTOP_TARGET_NOT_FRONTMOST");
        AssertInputReleased();
    }

    private static void AssertInputReleased()
    {
        foreach (var key in new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C, 1, 2 })
            if (Native.GetAsyncKeyState(key) < 0) throw new InvalidOperationException("DESKTOP_USER_INPUT_ACTIVE");
    }

    private static object Act(JsonElement input)
    {
        var target = Validate(ReadTarget(input));
        var action = input.GetProperty("action").GetString()!;
        var inspection = Inspect(target);
        if (Revision(target, inspection.Elements) != input.GetProperty("revision").GetString()) throw new InvalidOperationException("DESKTOP_OBSERVATION_STALE");
        Foreground(target);
        AutomationElement? node = null; Element? element = null;
        if (input.TryGetProperty("runtimeId", out var runtimeId))
        {
            var id = runtimeId.GetString()!;
            if (!inspection.Nodes.TryGetValue(id, out node)) throw new InvalidOperationException("DESKTOP_ELEMENT_STALE");
            element = inspection.Elements.Single(e => e.RuntimeId == id);
            if (element.Sensitive || !element.Enabled) throw new InvalidOperationException("DESKTOP_USER_TAKEOVER_REQUIRED");
            if (!element.Actions.Contains(action)) throw new InvalidOperationException("DESKTOP_ACTION_UNSUPPORTED");
        }
        if (action is "invoke" && element != null && CommitName.IsMatch(element.Name) && input.GetProperty("effect").GetString() == "local") throw new InvalidOperationException("DESKTOP_COMMIT_APPROVAL_REQUIRED");
        switch (action)
        {
            case "invoke": ((InvokePattern)node!.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); break;
            case "set_value": ((ValuePattern)node!.GetCurrentPattern(ValuePattern.Pattern)).SetValue(input.GetProperty("text").GetString()!); break;
            case "type_text":
                node!.SetFocus();
                Foreground(target);
                if (RuntimeId(AutomationElement.FocusedElement) != element!.RuntimeId) throw new InvalidOperationException("DESKTOP_TARGET_NOT_EDITABLE");
                foreach (var character in input.GetProperty("text").GetString()!)
                {
                    Foreground(target);
                    if (character == '\n') Native.Send(Native.Key(13), Native.Key(13, 0, 2));
                    else if (character != '\r') Native.Send(Native.Key(0, character, 4), Native.Key(0, character, 6));
                }
                break;
            case "key": SendKey(input.GetProperty("key").GetString()!, target, input.GetProperty("effect").GetString()!); break;
            case "click":
            case "scroll":
                var x = input.GetProperty("screenX").GetInt32(); var y = input.GetProperty("screenY").GetInt32();
                if (!Intersects(new(x, y, 1, 1), target.Bounds) || Native.GetAncestor(Native.WindowFromPoint(new Native.Point { X = x, Y = y }), 2) != Hwnd(target)) throw new InvalidOperationException("DESKTOP_COORDINATES_OCCLUDED");
                if (inspection.Elements.Any(e => e.Sensitive && Intersects(new(x, y, 1, 1), e.Bounds))) throw new InvalidOperationException("DESKTOP_USER_TAKEOVER_REQUIRED");
                if (action == "scroll") Native.Send(Native.Move(x, y), Native.Mouse(input.GetProperty("horizontal").GetBoolean() ? 0x1000u : 0x800u, unchecked((uint)input.GetProperty("delta").GetInt32())));
                else
                {
                    if (input.GetProperty("effect").GetString() == "local" && inspection.Elements.Any(e => CommitName.IsMatch(e.Name) && Intersects(new(x, y, 1, 1), e.Bounds))) throw new InvalidOperationException("DESKTOP_COMMIT_APPROVAL_REQUIRED");
                    var right = input.GetProperty("button").GetString() == "right";
                    for (var i = 0; i < input.GetProperty("count").GetInt32(); i++)
                    {
                        Foreground(target);
                        Native.Send(Native.Move(x, y), Native.Mouse(right ? 8u : 2u), Native.Mouse(right ? 16u : 4u));
                    }
                }
                break;
            default: throw new InvalidOperationException("DESKTOP_ACTION_UNSUPPORTED");
        }
        return new { dispatched = true };
    }

    private static void SendKey(string key, Target target, string effect)
    {
        var parts = key.Split('+', StringSplitOptions.TrimEntries);
        var modifiers = new List<ushort>();
        foreach (var part in parts[..^1])
        {
            ushort modifier = part.ToLowerInvariant() switch { "ctrl" => 0x11, "alt" => 0x12, "shift" => 0x10, _ => throw new InvalidOperationException("DESKTOP_KEY_UNSUPPORTED") };
            if (modifiers.Contains(modifier)) throw new InvalidOperationException("DESKTOP_KEY_UNSUPPORTED");
            modifiers.Add(modifier);
        }
        var last = parts[^1].ToLowerInvariant();
        ushort vk = last switch
        {
            "enter" => 13, "tab" => 9, "escape" => 27, "backspace" => 8, "delete" => 46,
            "left" => 37, "up" => 38, "right" => 39, "down" => 40, "home" => 36, "end" => 35,
            "pageup" => 33, "pagedown" => 34, "space" => 32,
            _ when last.Length == 1 && char.IsAsciiLetterOrDigit(last[0]) => (ushort)char.ToUpperInvariant(last[0]),
            _ => throw new InvalidOperationException("DESKTOP_KEY_UNSUPPORTED")
        };
        if (last == "tab" && modifiers.Contains(0x12)) throw new InvalidOperationException("DESKTOP_KEY_UNSUPPORTED");
        if (last is "enter" or "delete" && effect == "local") throw new InvalidOperationException("DESKTOP_COMMIT_APPROVAL_REQUIRED");
        Foreground(target);
        var inputs = modifiers.Select(m => Native.Key(m)).ToList();
        inputs.Add(Native.Key(vk)); inputs.Add(Native.Key(vk, 0, 2));
        inputs.AddRange(modifiers.AsEnumerable().Reverse().Select(m => Native.Key(m, 0, 2)));
        Native.Send(inputs.ToArray());
    }
}
