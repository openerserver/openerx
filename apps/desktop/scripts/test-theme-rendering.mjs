import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// Render the real styles in an isolated headless browser, including hover,
// native controls and nested labels. No app profile or account data is used.
const renderer = path.resolve(import.meta.dirname, "../src/renderer");
const read = (name) => readFileSync(path.join(renderer, name), "utf8");
const styles = [
  ...readdirSync(renderer)
    .filter(
      (name) =>
        name.endsWith(".css") && !["styles.css", "theme.css", "brand-theme.css"].includes(name),
    )
    .map(read),
  read("theme.css"),
  read("styles.css").replace('@import "./theme.css";', ""),
  read("projects/projects.css"),
  ...(existsSync(path.join(renderer, "brand-theme.css")) ? [read("brand-theme.css")] : []),
].join("\n");
const fixtures = `
<main>
  <section class="settings-page"><div class="settings-card settings-stack">
    <div class="settings-heading"><h2 data-contrast>外观设置</h2><p data-contrast>说明文字</p></div>
    <label data-contrast>账户名称<input data-contrast value="可编辑文字" placeholder="输入名称"></label>
    <select data-contrast><option data-contrast>系统默认选项</option></select>
    <div class="theme-options"><label class="theme-option is-selected"><input type="radio" checked><span class="theme-option-copy"><strong data-contrast>深色与浅色</strong><small data-contrast>主题说明文字</small></span></label></div>
    <p class="inline-error" data-contrast>错误信息</p><p class="inline-success" data-contrast>完成信息</p>
    <span class="account-status" data-contrast>账户未登录</span><span class="account-status account-signed_in" data-contrast>已登录</span>
    <span class="skill-trust trust-bundled" data-contrast>内置技能</span><span class="skill-enabled is-enabled" data-contrast>已启用</span>
    <p class="memory-supersede-note" data-contrast>记忆提示</p>
    <div class="diagnostic-metrics"><article><span data-contrast>诊断说明</span><strong data-contrast>运行数据</strong></article><article class="metric-over_budget"><small data-contrast>预算提醒</small></article></div>
    <span class="diagnostic-health health-ready" data-contrast>就绪</span><span class="diagnostic-health health-attention" data-contrast>需处理</span>
    <span class="release-status status-up_to_date" data-contrast>已更新</span><span class="release-status status-error" data-contrast>更新失败</span>
    <div class="billing-assets"><article class="billing-total"><span data-contrast>余额</span><strong data-contrast>100</strong></article></div>

  </div></section>
  <div class="pending-tool-approval"><div class="pending-approval-actions"><button data-contrast>拒绝</button><button class="primary-action" data-contrast data-hover>允许一次</button></div></div>
  <div class="composer"><textarea data-contrast placeholder="输入消息">消息文本</textarea><button class="primary-action" data-contrast data-hover><span data-contrast>发送</span><kbd data-contrast>↵</kbd></button></div>
  <article class="message message-user"><p data-contrast>用户消息</p></article>
  <article class="message message-assistant markdown-body"><p data-contrast>回复与<a href="#" data-contrast>链接文字</a><code data-contrast>行内代码</code></p><div class="code-block"><button data-contrast data-hover>复制</button><pre><code data-contrast>const readable = true;</code></pre></div></article>
  <div class="automation-detail"><button class="automation-create-button" data-contrast data-hover>创建任务</button><span class="run-succeeded" data-contrast>成功</span><span class="run-failed" data-contrast>失败</span><span class="run-running" data-contrast>运行中</span></div>
  <div class="desktop-control-bar"><div class="desktop-control-row"><span data-contrast>桌面操作进行中</span><button data-contrast data-hover>停止</button></div></div>
  <div class="workspace-edits"><div class="workspace-edits-header"><strong data-contrast>文件修改</strong><span class="workspace-edit-count" data-contrast>2 个文件</span></div><p class="workspace-edit-note" data-contrast>操作记录</p><p class="workspace-history-note" data-contrast>历史说明</p></div>
  <div class="project-notice" data-contrast>项目已创建</div>
  <div class="project-page"><button class="project-primary-button" data-contrast data-hover>创建项目</button></div>
  <div class="project-dialog"><footer><button class="project-primary-button" data-contrast data-hover>创建项目对话框</button></footer></div>
  <div class="confirmation-dialog-actions"><button class="danger-action" data-contrast data-hover>删除项目</button></div>
</main>`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.OPENERX_THEME_BROWSER_CHANNEL
    ? { channel: process.env.OPENERX_THEME_BROWSER_CHANNEL }
    : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const failures = [];
  let checked = 0;
  for (const theme of ["dark", "light"]) {
    await page.setContent(
      `<html data-brand="unicom-uwa" data-theme="${theme}"><head><style>${styles}</style><style>main{padding:32px} .pending-tool-approval,.desktop-control-bar{position:static} [data-contrast]{animation:none!important;transition:none!important}</style></head><body>${fixtures}</body></html>`,
    );
    const measure = async (selector) =>
      page.locator(selector).evaluateAll((elements) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const rgba = (color) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data].map((n, i) => (i === 3 ? n / 255 : n));
        };
        const over = (a, b) => [...a.slice(0, 3).map((n, i) => n * a[3] + b[i] * (1 - a[3])), 1];
        const light = (c) =>
          c
            .slice(0, 3)
            .map((n) => n / 255)
            .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
            .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
        return elements.map((el) => {
          const chain = [];
          for (let p = el; p; p = p.parentElement) chain.unshift(p);
          let bg = [255, 255, 255, 1];
          let opacity = 1;
          for (const p of chain) {
            const style = getComputedStyle(p);
            bg = over(rgba(style.backgroundColor), bg);
            opacity *= Number(style.opacity);
          }
          const style = getComputedStyle(el);
          const ink = rgba(style.color);
          ink[3] *= opacity;
          const fg = over(ink, bg);
          const ratio =
            (Math.max(light(fg), light(bg)) + 0.05) / (Math.min(light(fg), light(bg)) + 0.05);
          return {
            text: el.textContent?.trim(),
            className: el.className,
            color: style.color,
            background: bg,
            ratio,
          };
        });
      });
    const record = (rows, state) => {
      for (const row of rows) {
        checked++;
        if (row.ratio < 4.5) failures.push({ theme, state, ...row });
      }
    };
    record(await measure("[data-contrast]"), "default");
    for (const item of await page.locator("[data-hover]").all()) {
      await item.hover();
      record(
        await item
          .evaluate((el) => {
            el.setAttribute("data-current-hover", "");
          })
          .then(() => measure("[data-current-hover], [data-current-hover] [data-contrast]")),
        "hover",
      );
      await item.evaluate((el) => el.removeAttribute("data-current-hover"));
    }
    const focus = page.locator(".theme-option input");
    await focus.focus();
    assert.equal(
      await page.locator(".theme-option").evaluate((el) => getComputedStyle(el).outlineStyle),
      "solid",
    );
    assert.equal(
      await page
        .locator("textarea")
        .evaluate((el) => getComputedStyle(el, "::placeholder").opacity),
      "1",
    );
  }
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  console.log(
    `Theme rendering passed: ${checked} text and hover contrast checks, both themes, keyboard focus and placeholder opacity.`,
  );
} finally {
  await browser.close();
}
