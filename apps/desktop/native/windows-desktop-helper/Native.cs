using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace OpenErx.Desktop;

internal static class Native
{
    internal static readonly nint Marker = new(0x4F504E574443);
    [StructLayout(LayoutKind.Sequential)] private struct LastInput { public uint Size, Time; }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInput info);
    internal static uint LastInputTime()
    {
        var info = new LastInput { Size = (uint)Marshal.SizeOf<LastInput>() };
        if (!GetLastInputInfo(ref info)) throw new InvalidOperationException("DESKTOP_USER_INPUT_UNAVAILABLE");
        return info.Time;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] internal struct MouseInput { public int X, Y; public uint Data, Flags, Time; public nint Extra; }
    [StructLayout(LayoutKind.Sequential)] internal struct KeyInput { public ushort Key, Scan; public uint Flags, Time; public nint Extra; }
    [StructLayout(LayoutKind.Explicit)] internal struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyInput Key; }
    [StructLayout(LayoutKind.Sequential)] internal struct Input { public uint Type; public InputUnion Value; }
    [StructLayout(LayoutKind.Sequential)] internal struct MouseHook { public Point Point; public uint Data, Flags, Time; public nint Extra; }
    [StructLayout(LayoutKind.Sequential)] internal struct KeyHook { public uint Key, Scan, Flags, Time; public nint Extra; }
    [StructLayout(LayoutKind.Sequential)] internal struct Message { public nint Hwnd; public uint Id; public nuint WParam; public nint LParam; public uint Time; public Point Point; public uint Private; }
    internal delegate bool EnumProc(nint hwnd, nint param);
    internal delegate nint HookProc(int code, nint wParam, nint lParam);
    [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumProc callback, nint param);
    [DllImport("user32.dll")] internal static extern bool IsWindow(nint hwnd);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] internal static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] internal static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetWindowText(nint hwnd, StringBuilder value, int length);
    [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(nint hwnd);
    [DllImport("user32.dll")] internal static extern bool PrintWindow(nint hwnd, nint hdc, uint flags);
    [DllImport("user32.dll")] internal static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("user32.dll")] internal static extern bool ShowWindowAsync(nint hwnd, int command);
    [DllImport("user32.dll")] internal static extern nint GetAncestor(nint hwnd, uint flags);
    [DllImport("user32.dll")] internal static extern nint WindowFromPoint(Point point);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] internal static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)] internal static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll", SetLastError = true)] internal static extern nint OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] internal static extern bool CloseDesktop(nint desktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern bool GetUserObjectInformation(nint handle, int index, StringBuilder info, int length, out int needed);
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool WTSQuerySessionInformation(nint server, int session, int infoClass, out nint buffer, out uint bytes);
    [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(nint buffer);
    // Prefix of WTSINFOEXW on our supported Windows x64 target. The union is
    // aligned to 8 bytes because its full payload contains LARGE_INTEGER fields.
    [StructLayout(LayoutKind.Explicit, Size = 24)] private struct SessionInfoPrefix
    {
        [FieldOffset(0)] public uint Level;
        [FieldOffset(8)] public uint SessionId;
        [FieldOffset(12)] public int ConnectionState;
        [FieldOffset(16)] public int Flags;
    }
    [DllImport("user32.dll", SetLastError = true)] internal static extern nint SetWindowsHookEx(int hook, HookProc callback, nint module, uint thread);
    [DllImport("user32.dll")] internal static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")] internal static extern nint CallNextHookEx(nint hook, int code, nint wParam, nint lParam);
    [DllImport("user32.dll")] internal static extern int GetMessage(out Message message, nint hwnd, uint min, uint max);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern nint GetModuleHandle(string? name);
    [DllImport("kernel32.dll")] internal static extern bool CloseHandle(nint handle);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool OpenProcessToken(nint process, uint access, out nint token);
    [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool GetTokenInformation(nint token, int kind, nint info, uint size, out uint needed);
    [DllImport("advapi32.dll")] internal static extern nint GetSidSubAuthorityCount(nint sid);
    [DllImport("advapi32.dll")] internal static extern nint GetSidSubAuthority(nint sid, uint index);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern int GetApplicationUserModelId(nint process, ref uint length, StringBuilder value);

    internal static void AssertInteractive()
    {
        // On this Windows build OpenInputDesktop can still report Default while
        // the session is locked. Check WTS state before inspecting that desktop.
        if (!WTSQuerySessionInformation(0, -1, 25, out var buffer, out var bytes))
            throw new InvalidOperationException("DESKTOP_SESSION_STATE_UNAVAILABLE");
        try
        {
            if (buffer == 0 || bytes < Marshal.SizeOf<SessionInfoPrefix>())
                throw new InvalidOperationException("DESKTOP_SESSION_STATE_UNAVAILABLE");
            var state = Marshal.PtrToStructure<SessionInfoPrefix>(buffer);
            if (state.Level != 1) throw new InvalidOperationException("DESKTOP_SESSION_STATE_UNAVAILABLE");
            // WTSActive == 0, WTS_SESSIONSTATE_UNLOCK == 1 on Windows 10/11.
            if (state.ConnectionState != 0 || state.Flags != 1)
                throw new InvalidOperationException("DESKTOP_SESSION_LOCKED");
        }
        finally { WTSFreeMemory(buffer); }
        var desktop = OpenInputDesktop(0, false, 1);
        if (desktop == 0) throw new InvalidOperationException("DESKTOP_SESSION_LOCKED");
        try
        {
            var name = new StringBuilder(256);
            if (!GetUserObjectInformation(desktop, 2, name, 512, out _) || !name.ToString().Equals("Default", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("DESKTOP_SESSION_LOCKED");
        }
        finally { CloseDesktop(desktop); }
    }

    internal static int Integrity(nint process)
    {
        if (!OpenProcessToken(process, 8, out var token)) throw new InvalidOperationException("DESKTOP_TARGET_PERMISSION_DENIED");
        try
        {
            GetTokenInformation(token, 25, 0, 0, out var size);
            var buffer = Marshal.AllocHGlobal((int)size);
            try
            {
                if (!GetTokenInformation(token, 25, buffer, size, out _)) throw new InvalidOperationException("DESKTOP_TARGET_PERMISSION_DENIED");
                var sid = Marshal.ReadIntPtr(buffer);
                var count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        finally { CloseHandle(token); }
    }

    internal static Input Key(ushort key, ushort scan = 0, uint flags = 0) => new()
    { Type = 1, Value = new InputUnion { Key = new KeyInput { Key = key, Scan = scan, Flags = flags, Extra = Marker } } };
    internal static Input Mouse(uint flags, uint data = 0, int x = 0, int y = 0) => new()
    { Type = 0, Value = new InputUnion { Mouse = new MouseInput { Flags = flags, Data = data, X = x, Y = y, Extra = Marker } } };

    internal static Input Move(int x, int y)
    {
        var left = GetSystemMetrics(76); var top = GetSystemMetrics(77);
        var width = GetSystemMetrics(78); var height = GetSystemMetrics(79);
        if (width < 2 || height < 2 || x < left || y < top || x >= left + width || y >= top + height) throw new InvalidOperationException("DESKTOP_COORDINATES_INVALID");
        return Mouse(0x8000 | 0x4000 | 1, 0, (int)((x - (long)left) * 65535 / (width - 1)), (int)((y - (long)top) * 65535 / (height - 1)));
    }

    internal static void Send(params Input[] inputs)
    {
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>());
        if (sent == inputs.Length) return;
        // Only release the keys/buttons this particular batch could have pressed.
        foreach (var input in inputs.Take((int)sent))
        {
            if (input.Type == 1 && (input.Value.Key.Flags & 2) == 0)
            {
                var release = Key(input.Value.Key.Key, input.Value.Key.Scan, input.Value.Key.Flags | 2);
                SendInput(1, [release], Marshal.SizeOf<Input>());
            }
            if (input.Type == 0 && (input.Value.Mouse.Flags & (2u | 8u)) != 0)
            {
                var release = Mouse((input.Value.Mouse.Flags & 2) != 0 ? 4u : 16u);
                SendInput(1, [release], Marshal.SizeOf<Input>());
            }
        }
        throw new InvalidOperationException("DESKTOP_INPUT_OUTCOME_UNKNOWN");
    }
}

internal static class InputMonitor
{
    private static readonly Native.HookProc Keyboard = OnKeyboard;
    private static readonly Native.HookProc Mouse = OnMouse;
    private static bool reported;
    private static void Report(string source, nint message, uint flags, uint time, nint extra)
    {
        if (reported) return;
        reported = true;
        // Bounded diagnostic metadata only: never log keys, text or coordinates.
        Console.Error.WriteLine(System.Text.Json.JsonSerializer.Serialize(new
        {
            source, message = message.ToInt64(), flags, time,
            extra = extra.ToInt64().ToString("X"),
            injected = source == "keyboard" ? (flags & 0x10) != 0 : (flags & 1) != 0,
        }));
        Program.Write(new { @event = "user_input" });
    }
    private static nint OnKeyboard(int code, nint w, nint l)
    {
        if (code >= 0)
        {
            var input = Marshal.PtrToStructure<Native.KeyHook>(l);
            if (input.Extra != Native.Marker) Report("keyboard", w, input.Flags, input.Time, input.Extra);
        }
        return Native.CallNextHookEx(0, code, w, l);
    }
    private static nint OnMouse(int code, nint w, nint l)
    {
        if (code >= 0)
        {
            var input = Marshal.PtrToStructure<Native.MouseHook>(l);
            if (input.Extra != Native.Marker) Report("mouse", w, input.Flags, input.Time, input.Extra);
        }
        return Native.CallNextHookEx(0, code, w, l);
    }
    internal static int Run()
    {
        Native.AssertInteractive();
        var module = Native.GetModuleHandle(null);
        var keyboard = Native.SetWindowsHookEx(13, Keyboard, module, 0);
        var mouse = Native.SetWindowsHookEx(14, Mouse, module, 0);
        if (keyboard == 0 || mouse == 0) return 2;
        try
        {
            Program.Write(new { @event = "ready" });
            while (Native.GetMessage(out _, 0, 0, 0) > 0) { }
        }
        finally { Native.UnhookWindowsHookEx(keyboard); Native.UnhookWindowsHookEx(mouse); }
        return 0;
    }
}
