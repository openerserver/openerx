# BCU-003 Windows System Browser Evidence — 2026-08-29

- Status: `WINDOWS 11 X64 DEFAULT EDGE + DEFAULT CHROME UIA LIVE PASS / UNSIGNED PACKAGE PASS`
- Date: 2026-08-29 (Asia/Shanghai)
- Host: Windows 11 Home China, `10.0.26200`, x64
- Browser matrix: Microsoft Edge `152.0.4191.53`; Google Chrome `152.0.7977.65`
- Scope: `browser_computer_use_v2` system-default dedicated-window path only

## Implemented boundary

The Windows host now selects a platform-specific `ElectronWindowsSystemBrowserDriver`. Readiness requires Windows
PowerShell, the packaged helper, a supported default Chrome/Edge executable, a valid Microsoft/Google Authenticode
signature and an exact executable path.

The driver and `windows-browser-accessibility.ps1` provide:

- default HTTP(S) browser discovery for Edge and Chrome, including Windows 11 `UserChoiceLatest` with a validated
  fallback to legacy `UserChoice` and fail-closed HTTP/HTTPS parity;
- an UWA-created visible top-level window selected as the unique new HWND;
- exact executable path, PID, HWND and bounds correlation on every observation/action;
- Windows UI Automation `Document` observation with filtered visible interactive elements and opaque short-lived
  element references;
- `ValuePattern`, `InvokePattern`, selection and scroll semantic actions;
- marked `SendInput` native key, pointer and wheel fallback scoped to the exact foreground root HWND;
- exact-HWND `PrintWindow(PW_RENDERFULLCONTENT)` capture for Edge and Chrome, followed by WebArea crop and
  pre-output sensitive rectangle pixel masking;
- low-level keyboard/mouse takeover monitoring that ignores injected events and reports only real events targeting
  the bound root HWND;
- exact `WM_CLOSE` only for the UWA-created window.

The implementation does not expose DOM, selector, JavaScript, CDP, Cookie, password-store or browser history access.

## Automated verification

Desktop TypeScript completed with no errors. The complete desktop unit suite passed:

```text
Test Files  14 passed (14)
Tests       102 passed (102)
Duration    219.72s
```

The Windows-specific parser/security suite and readiness suite contributed 11 passing tests. PowerShell parser
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

After unifying Windows capture on the exact-HWND helper path, the complete Edge matrix was rerun and again returned
`applicationId=windows.microsoft-edge`, `closeState=closed`, 48 semantic elements and screenshot digest
`6237550d57c3875122de3200d02d3e2c3baab8a970eb3d841077047be42c0cd9`.

## Live Chrome-as-default matrix

Windows Settings was used to make the signed Google Chrome installation the actual HTTP and HTTPS default. This
exposed and closed two compatibility gaps that the Edge-only run could not detect:

1. current Windows 11 writes the live association to `UserChoiceLatest\\ProgId` while retaining an older
   `UserChoice` value; discovery now prefers the validated latest record and requires HTTP/HTTPS parity;
2. Electron/WGC timed out waiting for the first frame; Windows capture now uses a helper-owned exact-HWND
   `PrintWindow(PW_RENDERFULLCONTENT)` path after repeating the same PID/HWND/path/UIA-root identity checks for both
   supported browsers.

The production Adapter then completed the same Baidu `phonescloud` semantic search, `Backspace`, scroll, reload,
fresh Observation and exact close matrix with this result:

```json
{
  "contractVersion": "browser_computer_use_v2",
  "platform": "win32",
  "backend": "system_default",
  "controlPath": "os_accessibility",
  "applicationId": "windows.google-chrome",
  "query": "phonescloud",
  "semanticElementCount": 44,
  "screenshotDigest": "0d028012919293e99e8d033478e9ac747e24ad7ad9c933c5f5da822b110426ae",
  "nativeActions": ["Backspace", "scroll", "reload"],
  "closeState": "closed"
}
```

The final PNG was visually inspected and contained the real Baidu results page and query rather than an empty or
black frame. After the matrix, Microsoft Edge was restored as the machine default, production discovery again
returned `windows.microsoft-edge`, and the Chrome helper window enumeration returned an empty list.

## Package verification

The unsigned Windows x64 Forge package completed. The helper exists at:

```text
resources/app.asar.unpacked/native/windows-browser-accessibility.ps1
```

The packaged helper and source helper had the same SHA-256:

```text
93949F356C4E65129CAE0E05666152F77463BD02E18CDD59A0A6369E3E2CC8BF
```

The packaged helper independently returned the signed system-default Edge descriptor.

## Evidence boundary and remaining release gates

This closes the current Windows machine/default Edge and default Chrome system-browser implementation and local live
gate. It does not
claim:

- a Windows signed installer, upgrade/rollback or post-install permission persistence;
- alternate Windows builds, multi-display/DPI matrix or Firefox;
- a real installed MV3 Browser Bridge/Native Messaging transport;
- managed Chromium or controlled upload/download.

Those remain separate release and later BCU gates. Runtime behavior stays fail-closed when the helper, executable
signature, exact PID/HWND association, foreground identity, UIA Document or capture source cannot be verified.
