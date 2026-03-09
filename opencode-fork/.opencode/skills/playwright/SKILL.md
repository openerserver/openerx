---
name: playwright
description: Browser automation and UI testing with Playwright
metadata:
  permissions:
    allowedTools: [tmux_create_session, tmux_send_keys, tmux_read_output, tmux_kill_session, run_tests]
    deniedTools: []
    filePatterns: ["**/*.spec.ts", "**/*.test.ts", "**/e2e/**", "**/playwright.config.*"]
    maxConcurrency: 2
---

# Playwright — Browser Automation Skill

Provides structured guidance for browser automation, E2E testing, and visual regression testing using Playwright.

## Instructions

When this skill is active, follow these patterns for browser automation:

### Setup
- Use `npx playwright install` to ensure browsers are installed
- Configuration lives in `playwright.config.ts` at project root
- Tests go in `e2e/` or `tests/` directory with `.spec.ts` extension

### Writing Tests
- Use Page Object Model (POM) for complex pages
- Always use `await expect(locator).toBeVisible()` before interactions
- Prefer `getByRole()`, `getByText()`, `getByTestId()` over CSS selectors
- Use `test.describe()` for grouping related tests
- Add `test.beforeEach()` for common navigation/setup

### Running Tests
- Interactive: `npx playwright test --ui`  
- Headless: `npx playwright test`
- Single file: `npx playwright test path/to/test.spec.ts`
- Debug: `npx playwright test --debug`

### Visual Testing
- Use `await expect(page).toHaveScreenshot()` for visual regression
- Update snapshots: `npx playwright test --update-snapshots`

### Anti-Patterns
- NEVER use `page.waitForTimeout()` — use explicit waits
- NEVER hardcode URLs — use `baseURL` from config
- NEVER use `page.$eval()` — use locators instead
