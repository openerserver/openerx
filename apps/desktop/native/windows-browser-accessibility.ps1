param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('default-browser', 'windows', 'observe', 'capture', 'semantic', 'native', 'monitor', 'close')]
  [string]$Command,
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

function Fail([string]$Code) {
  throw $Code
}

function Initialize-UIAutomation {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  [void][BrowserWin32]::SetProcessDPIAware()
}

function Initialize-NativeTypes {
  if ('BrowserWin32' -as [type]) { return }
  Add-Type -AssemblyName System.Drawing
  Add-Type -ReferencedAssemblies @('System.dll', 'System.Drawing.dll') -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class BrowserWin32 {
  public const uint WM_CLOSE = 0x0010;
  public const uint INPUT_MOUSE = 0;
  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_WHEEL = 0x0800;
  public const uint MOUSEEVENTF_HWHEEL = 0x01000;
  public const int SW_RESTORE = 9;
  public const uint GA_ROOT = 2;
  public static readonly IntPtr InputMarker = new IntPtr(unchecked((long)0x4F504E5258424355));

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int x;
    public int y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int left;
    public int top;
    public int right;
    public int bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MSLLHOOKSTRUCT {
    public POINT pt;
    public uint mouseData;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MSG {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public POINT pt;
    public uint lPrivate;
  }

  public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetWindowsHookEx(int idHook, HookProc proc, IntPtr module, uint threadId);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] public static extern void PostQuitMessage(int code);
  [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string moduleName);

  private static INPUT KeyInput(ushort vk, ushort scan, uint flags) {
    INPUT input = new INPUT();
    input.type = INPUT_KEYBOARD;
    input.U.ki.wVk = vk;
    input.U.ki.wScan = scan;
    input.U.ki.dwFlags = flags;
    input.U.ki.dwExtraInfo = InputMarker;
    return input;
  }

  private static INPUT MouseInput(uint flags, uint data) {
    INPUT input = new INPUT();
    input.type = INPUT_MOUSE;
    input.U.mi.dwFlags = flags;
    input.U.mi.mouseData = data;
    input.U.mi.dwExtraInfo = InputMarker;
    return input;
  }

  private static void Send(INPUT[] inputs) {
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length) {
      throw new InvalidOperationException("BROWSER_OBSERVATION_MISMATCH");
    }
  }

  public static void Activate(long hwnd) {
    IntPtr target = new IntPtr(hwnd);
    if (!IsWindow(target)) throw new InvalidOperationException("BROWSER_SURFACE_NOT_BOUND");
    ShowWindow(target, SW_RESTORE);
    SetForegroundWindow(target);
  }

  public static bool ForegroundMatches(long hwnd) {
    IntPtr foreground = GetForegroundWindow();
    return foreground != IntPtr.Zero && GetAncestor(foreground, GA_ROOT).ToInt64() == hwnd;
  }

  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    Send(new [] { MouseInput(MOUSEEVENTF_LEFTDOWN, 0), MouseInput(MOUSEEVENTF_LEFTUP, 0) });
  }

  public static void Wheel(int x, int y, int delta, bool horizontal) {
    SetCursorPos(x, y);
    Send(new [] { MouseInput(horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, unchecked((uint)delta)) });
  }

  public static void VirtualKey(ushort vk, bool control, bool alt, bool shift) {
    var list = new System.Collections.Generic.List<INPUT>();
    if (control) list.Add(KeyInput(0x11, 0, 0));
    if (alt) list.Add(KeyInput(0x12, 0, 0));
    if (shift) list.Add(KeyInput(0x10, 0, 0));
    list.Add(KeyInput(vk, 0, 0));
    list.Add(KeyInput(vk, 0, KEYEVENTF_KEYUP));
    if (shift) list.Add(KeyInput(0x10, 0, KEYEVENTF_KEYUP));
    if (alt) list.Add(KeyInput(0x12, 0, KEYEVENTF_KEYUP));
    if (control) list.Add(KeyInput(0x11, 0, KEYEVENTF_KEYUP));
    Send(list.ToArray());
  }

  public static void UnicodeText(string value) {
    var list = new System.Collections.Generic.List<INPUT>();
    foreach (char character in value) {
      list.Add(KeyInput(0, character, KEYEVENTF_UNICODE));
      list.Add(KeyInput(0, character, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
    }
    if (list.Count > 0) Send(list.ToArray());
  }

  public static void Close(long hwnd) {
    IntPtr target = new IntPtr(hwnd);
    if (!IsWindow(target) || !PostMessage(target, WM_CLOSE, IntPtr.Zero, IntPtr.Zero)) {
      throw new InvalidOperationException("BROWSER_SURFACE_NOT_BOUND");
    }
  }

  public static string CapturePng(long hwnd) {
    IntPtr target = new IntPtr(hwnd);
    RECT rect;
    if (!IsWindow(target) || !GetWindowRect(target, out rect)) {
      throw new InvalidOperationException("BROWSER_SURFACE_NOT_BOUND");
    }
    int width = rect.right - rect.left;
    int height = rect.bottom - rect.top;
    if (width < 320 || height < 240 || width > 8192 || height > 8192) {
      throw new InvalidOperationException("BROWSER_SURFACE_MISMATCH");
    }
    using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (Graphics graphics = Graphics.FromImage(bitmap)) {
        IntPtr hdc = graphics.GetHdc();
        try {
          if (!PrintWindow(target, hdc, 2)) {
            throw new InvalidOperationException("BROWSER_OBSERVATION_REQUIRED");
          }
        } finally {
          graphics.ReleaseHdc(hdc);
        }
      }
      using (MemoryStream stream = new MemoryStream()) {
        bitmap.Save(stream, ImageFormat.Png);
        return Convert.ToBase64String(stream.ToArray());
      }
    }
  }
}

public static class BrowserInputMonitor {
  private const int WH_KEYBOARD_LL = 13;
  private const int WH_MOUSE_LL = 14;
  private const uint INJECTED_MOUSE = 0x00000001;
  private const uint INJECTED_KEYBOARD = 0x00000010;
  private static long targetWindow;
  private static bool reported;
  private static IntPtr keyboardHook;
  private static IntPtr mouseHook;
  private static BrowserWin32.HookProc keyboardProc = Keyboard;
  private static BrowserWin32.HookProc mouseProc = Mouse;

  private static bool SameRoot(IntPtr candidate) {
    if (candidate == IntPtr.Zero) return false;
    return BrowserWin32.GetAncestor(candidate, BrowserWin32.GA_ROOT).ToInt64() == targetWindow;
  }

  private static void Report() {
    if (reported) return;
    reported = true;
    Console.WriteLine("user_input");
    Console.Out.Flush();
    BrowserWin32.PostQuitMessage(0);
  }

  private static IntPtr Keyboard(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      var value = (BrowserWin32.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(BrowserWin32.KBDLLHOOKSTRUCT));
      if ((value.flags & INJECTED_KEYBOARD) == 0 && SameRoot(BrowserWin32.GetForegroundWindow())) Report();
    }
    return BrowserWin32.CallNextHookEx(keyboardHook, code, wParam, lParam);
  }

  private static IntPtr Mouse(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      var value = (BrowserWin32.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(BrowserWin32.MSLLHOOKSTRUCT));
      int message = wParam.ToInt32();
      bool meaningfulInput = message == 0x0201 || message == 0x0204 || message == 0x0207 || message == 0x020B || message == 0x020A || message == 0x020E;
      if (meaningfulInput && (value.flags & INJECTED_MOUSE) == 0 && SameRoot(BrowserWin32.WindowFromPoint(value.pt))) Report();
    }
    return BrowserWin32.CallNextHookEx(mouseHook, code, wParam, lParam);
  }

  public static void Run(long hwnd) {
    targetWindow = hwnd;
    if (!BrowserWin32.IsWindow(new IntPtr(hwnd))) throw new InvalidOperationException("BROWSER_SURFACE_NOT_BOUND");
    IntPtr module = BrowserWin32.GetModuleHandle(null);
    keyboardHook = BrowserWin32.SetWindowsHookEx(WH_KEYBOARD_LL, keyboardProc, module, 0);
    mouseHook = BrowserWin32.SetWindowsHookEx(WH_MOUSE_LL, mouseProc, module, 0);
    if (keyboardHook == IntPtr.Zero || mouseHook == IntPtr.Zero) throw new InvalidOperationException("BROWSER_BACKEND_UNAVAILABLE");
    Console.WriteLine("ready");
    Console.Out.Flush();
    BrowserWin32.MSG message;
    while (!reported && BrowserWin32.GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
    if (keyboardHook != IntPtr.Zero) BrowserWin32.UnhookWindowsHookEx(keyboardHook);
    if (mouseHook != IntPtr.Zero) BrowserWin32.UnhookWindowsHookEx(mouseHook);
  }
}
'@
}

Initialize-NativeTypes

function Decode-Text([string]$Value) {
  if ([string]::IsNullOrEmpty($Value)) { return '' }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

function Get-UrlAssociationProgId([string]$Scheme) {
  $associationPath = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\$Scheme"
  $latestPath = Join-Path $associationPath 'UserChoiceLatest'
  $latestProgIdPath = Join-Path $latestPath 'ProgId'
  if ((Test-Path -LiteralPath $latestPath) -or (Test-Path -LiteralPath $latestProgIdPath)) {
    if (-not (Test-Path -LiteralPath $latestPath) -or -not (Test-Path -LiteralPath $latestProgIdPath)) {
      Fail 'BROWSER_BACKEND_UNAVAILABLE'
    }
    $latestHash = (Get-ItemProperty -LiteralPath $latestPath).Hash
    $latestProgId = (Get-ItemProperty -LiteralPath $latestProgIdPath).ProgId
    if ([string]::IsNullOrWhiteSpace($latestHash) -or [string]::IsNullOrWhiteSpace($latestProgId)) {
      Fail 'BROWSER_BACKEND_UNAVAILABLE'
    }
    return [string]$latestProgId
  }

  $choicePath = Join-Path $associationPath 'UserChoice'
  if (-not (Test-Path -LiteralPath $choicePath)) { Fail 'BROWSER_BACKEND_UNAVAILABLE' }
  $choice = Get-ItemProperty -LiteralPath $choicePath
  if ([string]::IsNullOrWhiteSpace($choice.Hash) -or [string]::IsNullOrWhiteSpace($choice.ProgId)) {
    Fail 'BROWSER_BACKEND_UNAVAILABLE'
  }
  return [string]$choice.ProgId
}

function Get-Pattern($Element, $Pattern) {
  $value = $null
  if ($Element.TryGetCurrentPattern($Pattern, [ref]$value)) { return $value }
  return $null
}

function Get-DefaultBrowser {
  Initialize-UIAutomation
  $httpProgId = Get-UrlAssociationProgId 'http'
  $httpsProgId = Get-UrlAssociationProgId 'https'
  if (-not $httpProgId.Equals($httpsProgId, [StringComparison]::OrdinalIgnoreCase)) {
    Fail 'BROWSER_BACKEND_UNAVAILABLE'
  }
  $progId = $httpsProgId
  $candidates = @()
  if ($progId -like 'MSEdgeHTM*') {
    $candidates = @(
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
    )
  } elseif ($progId -like 'ChromeHTML*') {
    $candidates = @(
      "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe"
    )
  } else {
    Fail 'BROWSER_BACKEND_UNAVAILABLE'
  }
  $executable = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  if (-not $executable) { Fail 'BROWSER_BACKEND_UNAVAILABLE' }
  $resolved = (Get-Item -LiteralPath $executable).FullName
  $leaf = [IO.Path]::GetFileName($resolved).ToLowerInvariant()
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
  $signature = Get-AuthenticodeSignature -FilePath $resolved
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) { Fail 'BROWSER_BACKEND_UNAVAILABLE' }
  $subject = $signature.SignerCertificate.Subject
  if ($leaf -eq 'msedge.exe' -and $subject -notmatch 'Microsoft Corporation') { Fail 'BROWSER_BACKEND_UNAVAILABLE' }
  if ($leaf -eq 'chrome.exe' -and $subject -notmatch 'Google LLC') { Fail 'BROWSER_BACKEND_UNAVAILABLE' }
  if ($leaf -eq 'msedge.exe') {
    [pscustomobject]@{ applicationId = 'windows.microsoft-edge'; applicationName = 'Microsoft Edge'; executablePath = $resolved; processName = 'msedge' }
  } elseif ($leaf -eq 'chrome.exe') {
    [pscustomobject]@{ applicationId = 'windows.google-chrome'; applicationName = 'Google Chrome'; executablePath = $resolved; processName = 'chrome' }
  } else {
    Fail 'BROWSER_BACKEND_UNAVAILABLE'
  }
}

function Get-RootWindow([int]$ProcessId, [long]$WindowId) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $matches = @()
  for ($index = 0; $index -lt $windows.Count; $index += 1) {
    $candidate = $windows.Item($index)
    try {
      if ($candidate.Current.ProcessId -eq $ProcessId -and $candidate.Current.NativeWindowHandle -eq $WindowId) { $matches += $candidate }
    } catch { }
  }
  if ($matches.Count -ne 1) { Fail 'BROWSER_SURFACE_NOT_BOUND' }
  return $matches[0]
}

function Get-WindowRecord($Window, [string]$ApplicationId, [string]$ApplicationName, [string]$ExpectedExecutable, [string]$ExpectedProcessName) {
  $processId = $Window.Current.ProcessId
  $process = Get-Process -Id $processId -ErrorAction Stop
  $actualPath = $process.Path
  if (-not $actualPath -or -not ([IO.Path]::GetFullPath($actualPath).Equals([IO.Path]::GetFullPath($ExpectedExecutable), [StringComparison]::OrdinalIgnoreCase))) {
    Fail 'BROWSER_SURFACE_MISMATCH'
  }
  if (-not $process.ProcessName.Equals($ExpectedProcessName, [StringComparison]::OrdinalIgnoreCase)) { Fail 'BROWSER_SURFACE_MISMATCH' }
  $bounds = $Window.Current.BoundingRectangle
  if ($bounds.IsEmpty -or [double]::IsNaN($bounds.X) -or [double]::IsInfinity($bounds.X) -or $bounds.Width -lt 320 -or $bounds.Height -lt 240) { Fail 'BROWSER_SURFACE_NOT_BOUND' }
  [pscustomobject]@{
    applicationId = $ApplicationId
    applicationName = $ApplicationName
    executablePath = $actualPath
    processName = $process.ProcessName.ToLowerInvariant()
    processId = $processId
    windowId = [long]$Window.Current.NativeWindowHandle
    title = [string]$Window.Current.Name
    bounds = [pscustomobject]@{ x = [int][Math]::Round($bounds.X); y = [int][Math]::Round($bounds.Y); width = [int][Math]::Round($bounds.Width); height = [int][Math]::Round($bounds.Height) }
  }
}

function Get-BrowserWindows([string]$ExecutablePath, [string]$ApplicationId, [string]$ApplicationName, [string]$ProcessName) {
  Initialize-UIAutomation
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $result = New-Object System.Collections.Generic.List[object]
  for ($index = 0; $index -lt $windows.Count; $index += 1) {
    $candidate = $windows.Item($index)
    try {
      if ($candidate.Current.ClassName -ne 'Chrome_WidgetWin_1') { continue }
      if ($candidate.Current.NativeWindowHandle -le 0 -or [string]::IsNullOrWhiteSpace($candidate.Current.Name)) { continue }
      $record = Get-WindowRecord $candidate $ApplicationId $ApplicationName $ExecutablePath $ProcessName
      if ($record.bounds.x -le -30000 -or $record.bounds.y -le -30000) { continue }
      $result.Add($record)
    } catch {
      if ($_.Exception.Message -eq 'BROWSER_SURFACE_MISMATCH') { continue }
    }
  }
  return $result.ToArray()
}

function Get-WindowCapture([int]$ProcessId, [long]$WindowId, [string]$ApplicationId, [string]$ApplicationName, [string]$ExecutablePath, [string]$ProcessName) {
  Initialize-UIAutomation
  $window = Get-RootWindow $ProcessId $WindowId
  $target = Get-WindowRecord $window $ApplicationId $ApplicationName $ExecutablePath $ProcessName
  [pscustomobject]@{
    target = $target
    pngBase64 = [BrowserWin32]::CapturePng($WindowId)
  }
}

function Get-Document($Window) {
  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
  $documents = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  $best = $null
  $bestArea = 0
  for ($index = 0; $index -lt $documents.Count; $index += 1) {
    $candidate = $documents.Item($index)
    try {
      $bounds = $candidate.Current.BoundingRectangle
      $area = $bounds.Width * $bounds.Height
      if (-not $candidate.Current.IsOffscreen -and $bounds.Width -gt 100 -and $bounds.Height -gt 100 -and $area -gt $bestArea) {
        $best = $candidate
        $bestArea = $area
      }
    } catch { }
  }
  if (-not $best) { Fail 'BROWSER_OBSERVATION_REQUIRED' }
  return $best
}

function Get-Role($Element) {
  $name = $Element.Current.ControlType.ProgrammaticName
  switch ($name) {
    'ControlType.Button' { 'button' }
    'ControlType.Hyperlink' { 'link' }
    'ControlType.Edit' { 'textbox' }
    'ControlType.ComboBox' { 'combobox' }
    'ControlType.CheckBox' { 'checkbox' }
    'ControlType.RadioButton' { 'radio' }
    'ControlType.ListItem' { 'option' }
    'ControlType.MenuItem' { 'menuitem' }
    'ControlType.TreeItem' { 'treeitem' }
    'ControlType.TabItem' { 'tab' }
    default { $null }
  }
}

function Get-SensitiveKind($Element, [string]$Name) {
  try { if ($Element.Current.IsPassword) { return 'password' } } catch { }
  if ($Name -match '(?i)password|passcode|pin|\u5bc6\u7801|\u53e3\u4ee4') { return 'password' }
  if ($Name -match '(?i)card number|credit card|cvv|cvc|\u94f6\u884c\u5361|\u5361\u53f7|\u652f\u4ed8') { return 'payment' }
  if ($Name -match '(?i)verification code|one.?time|otp|authenticator|\u9a8c\u8bc1\u7801|\u8ba4\u8bc1\u7801') { return 'authentication' }
  return 'none'
}

function Get-Observation([int]$ProcessId, [long]$WindowId, [string]$ApplicationId, [string]$ApplicationName, [string]$ExecutablePath, [string]$ProcessName) {
  Initialize-UIAutomation
  $window = Get-RootWindow $ProcessId $WindowId
  $target = Get-WindowRecord $window $ApplicationId $ApplicationName $ExecutablePath $ProcessName
  $document = Get-Document $window
  $documentBounds = $document.Current.BoundingRectangle
  $urlPattern = Get-Pattern $document ([System.Windows.Automation.ValuePattern]::Pattern)
  $url = if ($urlPattern) { [string]$urlPattern.Current.Value } else { '' }
  if ([string]::IsNullOrWhiteSpace($url)) {
    $edits = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
    for ($index = 0; $index -lt $edits.Count; $index += 1) {
      $valuePattern = Get-Pattern $edits.Item($index) ([System.Windows.Automation.ValuePattern]::Pattern)
      if ($valuePattern -and ([string]$valuePattern.Current.Value) -match '^https?://') { $url = [string]$valuePattern.Current.Value; break }
    }
  }
  if ($url -notmatch '^https?://') { Fail 'BROWSER_NAVIGATION_DENIED' }
  $descendants = $document.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $elements = New-Object System.Collections.Generic.List[object]
  for ($index = 0; $index -lt $descendants.Count -and $elements.Count -lt 2000; $index += 1) {
    $element = $descendants.Item($index)
    try {
      $role = Get-Role $element
      if (-not $role -or $element.Current.IsOffscreen) { continue }
      $bounds = $element.Current.BoundingRectangle
      if ($bounds.IsEmpty -or [double]::IsNaN($bounds.X) -or [double]::IsInfinity($bounds.X) -or $bounds.Width -lt 1 -or $bounds.Height -lt 1) { continue }
      $left = [Math]::Max($documentBounds.X, $bounds.X)
      $top = [Math]::Max($documentBounds.Y, $bounds.Y)
      $right = [Math]::Min($documentBounds.Right, $bounds.Right)
      $bottom = [Math]::Min($documentBounds.Bottom, $bounds.Bottom)
      if ($right -le $left -or $bottom -le $top) { continue }
      $name = ([string]$element.Current.Name).Normalize([Text.NormalizationForm]::FormC)
      if ($name.Length -gt 500) { $name = $name.Substring(0, 500) }
      $sensitiveKind = Get-SensitiveKind $element $name
      $value = $null
      $valuePattern = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
      $editable = $false
      if ($valuePattern) {
        $editable = -not $valuePattern.Current.IsReadOnly
        if ($sensitiveKind -eq 'none') {
          $value = [string]$valuePattern.Current.Value
          if ($value.Length -gt 2000) { $value = $value.Substring(0, 2000) }
        }
      }
      $actions = New-Object System.Collections.Generic.List[string]
      if ($element.Current.IsKeyboardFocusable) { $actions.Add('focus') }
      if ($editable) { $actions.Add('setValue') }
      $invokePattern = Get-Pattern $element ([System.Windows.Automation.InvokePattern]::Pattern)
      $togglePattern = Get-Pattern $element ([System.Windows.Automation.TogglePattern]::Pattern)
      $selectionPattern = Get-Pattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if ($invokePattern -or $togglePattern -or $selectionPattern) { $actions.Add('invoke') }
      $expandPattern = Get-Pattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      if ($selectionPattern -or $expandPattern -or $role -eq 'combobox') { $actions.Add('select') }
      $scrollPattern = Get-Pattern $element ([System.Windows.Automation.ScrollPattern]::Pattern)
      if ($scrollPattern) { $actions.Add('scroll') }
      $checked = $null
      if ($togglePattern) { $checked = $togglePattern.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On }
      $selected = $null
      if ($selectionPattern) { $selected = [bool]$selectionPattern.Current.IsSelected }
      $expanded = $null
      if ($expandPattern) { $expanded = $expandPattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded }
      $elements.Add([pscustomobject]@{
        sourceNodeId = "uia_$index"
        role = $role
        name = $name
        value = $value
        sensitiveKind = $sensitiveKind
        visible = $true
        state = [pscustomobject]@{ disabled = -not $element.Current.IsEnabled; checked = $checked; selected = $selected; expanded = $expanded; focused = [bool]$element.Current.HasKeyboardFocus; editable = $editable }
        bounds = [pscustomobject]@{ x = [int][Math]::Round($left - $documentBounds.X); y = [int][Math]::Round($top - $documentBounds.Y); width = [Math]::Max(1, [int][Math]::Round($right - $left)); height = [Math]::Max(1, [int][Math]::Round($bottom - $top)) }
        actions = @($actions.ToArray())
      })
    } catch { }
  }
  [pscustomobject]@{
    target = $target
    url = $url
    title = [string]$document.Current.Name
    webAreaBounds = [pscustomobject]@{ x = [int][Math]::Round($documentBounds.X); y = [int][Math]::Round($documentBounds.Y); width = [int][Math]::Round($documentBounds.Width); height = [int][Math]::Round($documentBounds.Height) }
    elements = @($elements.ToArray())
  }
}

function Assert-Element([int]$ProcessId, [long]$WindowId, [int]$SourceIndex, [string]$ExpectedRole, [string]$ExpectedName, [int]$ExpectedX, [int]$ExpectedY, [int]$ExpectedWidth, [int]$ExpectedHeight) {
  Initialize-UIAutomation
  $window = Get-RootWindow $ProcessId $WindowId
  $document = Get-Document $window
  $descendants = $document.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $documentBounds = $document.Current.BoundingRectangle
  $matches = New-Object System.Collections.Generic.List[object]
  $candidateIndexes = New-Object System.Collections.Generic.List[int]
  if ($SourceIndex -ge 0 -and $SourceIndex -lt $descendants.Count) { $candidateIndexes.Add($SourceIndex) }
  for ($index = 0; $index -lt $descendants.Count; $index += 1) {
    if ($index -ne $SourceIndex) { $candidateIndexes.Add($index) }
  }
  foreach ($index in $candidateIndexes) {
    $candidate = $descendants.Item($index)
    try {
      $role = Get-Role $candidate
      $name = ([string]$candidate.Current.Name).Normalize([Text.NormalizationForm]::FormC)
      $bounds = $candidate.Current.BoundingRectangle
      $matchesIdentity = $role -eq $ExpectedRole -and $name -eq $ExpectedName
      $matchesBounds = [Math]::Abs(($bounds.X - $documentBounds.X) - $ExpectedX) -le 4 -and [Math]::Abs(($bounds.Y - $documentBounds.Y) - $ExpectedY) -le 4 -and [Math]::Abs($bounds.Width - $ExpectedWidth) -le 4 -and [Math]::Abs($bounds.Height - $ExpectedHeight) -le 4
      if ($matchesIdentity -and $matchesBounds) {
        $matches.Add($candidate)
        if ($index -eq $SourceIndex) { return $candidate }
      }
    } catch { }
  }
  if ($matches.Count -ne 1) { Fail 'BROWSER_OBSERVATION_MISMATCH' }
  return $matches[0]
}

function Invoke-Semantic {
  $processId = [int]$Arguments[0]
  $windowId = [long]$Arguments[1]
  $sourceIndex = [int]$Arguments[2]
  $action = $Arguments[3]
  $payload = Decode-Text $Arguments[4]
  $role = $Arguments[5]
  $name = Decode-Text $Arguments[6]
  $element = Assert-Element $processId $windowId $sourceIndex $role $name ([int]$Arguments[7]) ([int]$Arguments[8]) ([int]$Arguments[9]) ([int]$Arguments[10])
  if ((Get-SensitiveKind $element $name) -ne 'none') { Fail 'BROWSER_USER_TAKEOVER_REQUIRED' }
  switch ($action) {
    'focus' { if (-not $element.Current.IsKeyboardFocusable) { 'unsupported'; return }; $element.SetFocus(); 'performed'; return }
    'setValue' { $pattern = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern); if (-not $pattern -or $pattern.Current.IsReadOnly) { 'unsupported'; return }; $element.SetFocus(); $pattern.SetValue($payload); 'performed'; return }
    'invoke' {
      $pattern = Get-Pattern $element ([System.Windows.Automation.InvokePattern]::Pattern)
      if ($pattern) { $pattern.Invoke(); 'performed'; return }
      $pattern = Get-Pattern $element ([System.Windows.Automation.TogglePattern]::Pattern)
      if ($pattern) { $pattern.Toggle(); 'performed'; return }
      $pattern = Get-Pattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if ($pattern) { $pattern.Select(); 'performed'; return }
      'unsupported'; return
    }
    'select' {
      $expand = Get-Pattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      if ($expand) { $expand.Expand(); Start-Sleep -Milliseconds 100 }
      $options = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      for ($index = 0; $index -lt $options.Count; $index += 1) {
        $option = $options.Item($index)
        if ([string]$option.Current.Name -ne $payload) { continue }
        $selection = Get-Pattern $option ([System.Windows.Automation.SelectionItemPattern]::Pattern)
        if ($selection) { $selection.Select(); if ($expand) { $expand.Collapse() }; 'performed'; return }
        $invoke = Get-Pattern $option ([System.Windows.Automation.InvokePattern]::Pattern)
        if ($invoke) { $invoke.Invoke(); if ($expand) { $expand.Collapse() }; 'performed'; return }
      }
      if ($expand) { $expand.Collapse() }
      'unsupported'; return
    }
    'scroll' {
      $pattern = Get-Pattern $element ([System.Windows.Automation.ScrollPattern]::Pattern)
      if (-not $pattern) { 'unsupported'; return }
      $parts = $payload.Split(':')
      $amount = if ($parts[1] -eq 'small') { [System.Windows.Automation.ScrollAmount]::SmallIncrement } else { [System.Windows.Automation.ScrollAmount]::LargeIncrement }
      $none = [System.Windows.Automation.ScrollAmount]::NoAmount
      switch ($parts[0]) {
        'down' { $pattern.Scroll($none, $amount) }
        'up' { $pattern.Scroll($none, [System.Windows.Automation.ScrollAmount]::LargeDecrement) }
        'right' { $pattern.Scroll($amount, $none) }
        'left' { $pattern.Scroll([System.Windows.Automation.ScrollAmount]::LargeDecrement, $none) }
        default { 'unsupported'; return }
      }
      'performed'; return
    }
    default { 'unsupported'; return }
  }
}

function Invoke-Native {
  $processId = [int]$Arguments[0]
  $windowId = [long]$Arguments[1]
  $action = $Arguments[2]
  $payload = Decode-Text $Arguments[3]
  $x = [int]$Arguments[4]
  $y = [int]$Arguments[5]
  Initialize-UIAutomation
  $window = Get-RootWindow $processId $windowId
  [BrowserWin32]::Activate($windowId)
  Start-Sleep -Milliseconds 50
  if (-not [BrowserWin32]::ForegroundMatches($windowId)) { Fail 'BROWSER_SURFACE_MISMATCH' }
  if ($action -in @('back', 'forward', 'reload')) {
    $automationId = if ($action -eq 'back') { 'view_1001' } elseif ($action -eq 'forward') { 'view_1002' } else { 'view_1003' }
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $automationId)
    $button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($button) { $invoke = Get-Pattern $button ([System.Windows.Automation.InvokePattern]::Pattern); if ($invoke) { $invoke.Invoke(); 'performed'; return } }
    if ($action -eq 'back') { [BrowserWin32]::VirtualKey(0x25, $false, $true, $false) }
    elseif ($action -eq 'forward') { [BrowserWin32]::VirtualKey(0x27, $false, $true, $false) }
    else { [BrowserWin32]::VirtualKey(0x52, $true, $false, $false) }
    'performed'; return
  }
  if ($x -ge 0 -and $y -ge 0) { [BrowserWin32]::Click($x, $y); Start-Sleep -Milliseconds 40 }
  switch ($action) {
    { $_ -in @('click', 'invoke', 'submit', 'focus') } { if ($x -lt 0 -or $y -lt 0) { 'unsupported' } else { 'performed' }; return }
    { $_ -in @('type', 'setValue') } { [BrowserWin32]::UnicodeText($payload); 'performed'; return }
    'key' {
      $keys = @{ backspace = 0x08; tab = 0x09; enter = 0x0D; space = 0x20; pageup = 0x21; pagedown = 0x22; end = 0x23; home = 0x24; left = 0x25; up = 0x26; right = 0x27; down = 0x28; delete = 0x2E }
      if (-not $keys.ContainsKey($payload)) { 'unsupported'; return }
      [BrowserWin32]::VirtualKey([uint16]$keys[$payload], $false, $false, $false); 'performed'; return
    }
    'scroll' {
      $parts = $payload.Split(':')
      $steps = if ($parts[1] -eq 'small') { 1 } elseif ($parts[1] -eq 'medium') { 3 } elseif ($parts[1] -eq 'viewport') { 7 } else { 14 }
      $delta = 120 * $steps
      if ($parts[0] -in @('down', 'left')) { $delta = -$delta }
      [BrowserWin32]::Wheel($x, $y, $delta, ($parts[0] -in @('left', 'right'))); 'performed'; return
    }
    default { 'unsupported'; return }
  }
}

switch ($Command) {
  'default-browser' { Get-DefaultBrowser | ConvertTo-Json -Compress -Depth 6; break }
  'windows' { ConvertTo-Json -InputObject @(Get-BrowserWindows $Arguments[0] $Arguments[1] $Arguments[2] $Arguments[3]) -Compress -Depth 6; break }
  'observe' { Get-Observation ([int]$Arguments[0]) ([long]$Arguments[1]) $Arguments[2] $Arguments[3] $Arguments[4] $Arguments[5] | ConvertTo-Json -Compress -Depth 10; break }
  'capture' { Get-WindowCapture ([int]$Arguments[0]) ([long]$Arguments[1]) $Arguments[2] $Arguments[3] $Arguments[4] $Arguments[5] | ConvertTo-Json -Compress -Depth 8; break }
  'semantic' { Invoke-Semantic; break }
  'native' { Invoke-Native; break }
  'monitor' { [BrowserInputMonitor]::Run([long]$Arguments[1]); break }
  'close' { [BrowserWin32]::Close([long]$Arguments[1]); 'performed'; break }
}
