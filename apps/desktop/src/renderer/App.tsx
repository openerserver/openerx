import type { DesktopEnvironment } from "@openerx/contracts";
import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";

const suggestions = [
  "总结一份工作文档",
  "分析表格中的关键变化",
  "起草一封正式邮件",
  "规划一个复杂任务",
];

function NewChat(): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");

  return (
    <main className="chat-page">
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">OpenerX 2.0</p>
        <h1 id="welcome-title">今天想完成什么？</h1>
        <p>从对话开始，按需连接文件、工具和 Skill。</p>
      </section>

      <section className="suggestion-grid" aria-label="常用建议">
        {suggestions.map((suggestion) => (
          <button
            type="button"
            key={suggestion}
            className="suggestion-card"
            onClick={() => {
              setDraft(suggestion);
              setStatus("");
            }}
          >
            {suggestion}
          </button>
        ))}
      </section>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) {
            setStatus("交互已记录；消息运行闭环将在 M1 Chat Alpha 接入。");
          }
        }}
      >
        <label htmlFor="message">发送消息</label>
        <textarea
          id="message"
          rows={3}
          placeholder="输入你的需求…"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus("");
          }}
        />
        <div className="composer-actions">
          <button type="button" className="secondary-action">
            添加文件
          </button>
          <button type="submit" className="primary-action" disabled={!draft.trim()}>
            发送
          </button>
        </div>
        <p className="composer-status" role="status">
          {status}
        </p>
      </form>
    </main>
  );
}

function Placeholder({ title }: { title: string }): React.JSX.Element {
  return (
    <main className="placeholder-page">
      <p className="eyebrow">M0 页面骨架</p>
      <h1>{title}</h1>
      <p>该入口已经进入 V2 路由，业务闭环将在对应检查点实现。</p>
    </main>
  );
}

export function App(): React.JSX.Element {
  const [environment, setEnvironment] = useState<DesktopEnvironment | null>(null);

  useEffect(() => {
    let active = true;
    window.openerx
      .getEnvironment()
      .then((value) => {
        if (active) setEnvironment(value);
      })
      .catch(() => {
        if (active) setEnvironment(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">OpenerX</div>
        <nav aria-label="主导航">
          <NavLink to="/chat/new">新对话</NavLink>
          <NavLink to="/search">搜索</NavLink>
          <NavLink to="/files">个人文件</NavLink>
          <NavLink to="/assistants">助手与 Skill</NavLink>
          <NavLink to="/settings/account">设置</NavLink>
        </nav>
        <div className="sync-state">
          <span aria-hidden="true" />
          {environment ? `${environment.platform} · 本地就绪` : "正在连接桌面服务"}
        </div>
      </aside>

      <Routes>
        <Route path="/chat/new" element={<NewChat />} />
        <Route path="/search" element={<Placeholder title="搜索" />} />
        <Route path="/files" element={<Placeholder title="个人文件与成果" />} />
        <Route path="/assistants" element={<Placeholder title="助手与 Skill" />} />
        <Route path="/settings/*" element={<Placeholder title="设置" />} />
        <Route path="*" element={<Navigate to="/chat/new" replace />} />
      </Routes>
    </div>
  );
}
