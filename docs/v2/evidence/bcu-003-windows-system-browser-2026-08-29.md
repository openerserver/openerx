# BCU-003 Windows System Browser Evidence — 2026-08-29

- Status: `WINDOWS 11 X64 DEFAULT EDGE UIA LIVE PASS / UNSIGNED PACKAGE PASS`
- Date: 2026-08-29 (Asia/Shanghai)
- Host: Windows 11 Home China, `10.0.26200`, x64
- Browser: system default Microsoft Edge `152.0.4191.53`
- Scope: `browser_computer_use_v2` system-default dedicated-window path only

## Implemented boundary

The Windows host now selects a platform-specific `ElectronWindowsSystemBrowserDriver`. Readiness requires Windows
PowerShell, the packaged helper, a supported default Chrome/Edge executable, a valid Microsoft/Google Authenticode
signature and an exact executable path.

The driver and `windows-browser-accessibility.ps1` provide:

- default HTTP(S) browser discovery for Edge and Chrome;
- an OpenerX-created visible top-level window selected as the unique new HWND;
- exact executable path, PID, HWND and bounds correlation on every observation/action;
- Windows UI Automation `Document` observation with filtered visible interactive elements and opaque short-lived
  element references;
- `ValuePattern`, `InvokePattern`, selection and scroll semantic actions;
- marked `SendInput` native key, pointer and wheel fallback scoped to the exact foreground root HWND;
- exact-window Electron capture, WebArea crop and pre-output sensitive rectangle pixel masking;
- low-level keyboard/mouse takeover monitoring that ignores injected events and reports only real events targeting
  the bound root HWND;
- exact `WM_CLOSE` only for the OpenerX-created window.

The implementation does not expose DOM, selector, JavaScript, CDP, Cookie, password-store or browser history access.

## Automated verification

Desktop TypeScript completed with no errors. The complete desktop unit suite passed:

```text
Test Files  14 passed (14)
Tests       101 passed (101)
Duration    194.33s
```

The Windows-specific parser/security suite and readiness suite contributed 10 passing tests. PowerShell parser
validation completed with zero syntax errors. Biome completed for all changed TypeScript, JSON and config files.

## Live default-browser smoke

The Electron smoke runner used the production Adapter and Windows Driver to open the real system-default Edge,
navigate to Baidu and execute:

1. UIA `setValue("phonescloud")` on the visible search box;
2. injected `Backspace`, verified as `phonesclou`, then semantic restore to `phonescloud`;
3. semantic invoke of `百度一下`;
4. native small scroll and browser reload;
5. fresh observations and exact dedicated-window close.

Final evidence:

```json
{
  "contractVersion": "browser_computer_use_v2",
  "platform": "win32",
  "backend": "system_default",
  "controlPath": "os_accessibility",
  "applicationId": "windows.microsoft-edge",
  "query": "phonescloud",
  "nativeActions": ["Backspace", "scroll", "reload"],
  "closeState": "closed"
}
```

The final captured WebArea visibly contained the Baidu results page and `phonescloud` query. A separately armed
low-level monitor stayed active after marked synthetic pointer input, proving that the helper does not classify its
own injected input as user takeover.

## Package verification

The unsigned Windows x64 Forge package completed. The helper exists at:

```text
resources/app.asar.unpacked/native/windows-browser-accessibility.ps1
```

The packaged helper and source helper had the same SHA-256:

```text
9DF0E5CE3BECE1B9E2D68C9018A8E1096B409A54392CA8265F96F373081F5869
```

The packaged helper independently returned the signed system-default Edge descriptor.

## Evidence boundary and remaining release gates

This closes the current Windows machine/default Edge system-browser implementation and local live gate. It does not
claim:

- a Windows signed installer, upgrade/rollback or post-install permission persistence;
- the Chrome-as-default live matrix, alternate Windows builds, multi-display/DPI matrix or Firefox;
- a real installed MV3 Browser Bridge/Native Messaging transport;
- managed Chromium or controlled upload/download.

Those remain separate release and later BCU gates. Runtime behavior stays fail-closed when the helper, executable
signature, exact PID/HWND association, foreground identity, UIA Document or capture source cannot be verified.
