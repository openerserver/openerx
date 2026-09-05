import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { desktopBrand } from "../../../../packages/branding/src/index";
import { App } from "./App";
import "./styles.css";
import "./projects/projects.css";

const root = document.getElementById("root");
document.title = desktopBrand.productName;
document.documentElement.style.setProperty("--workspace-accent", desktopBrand.colors.accent);
document.documentElement.style.setProperty(
  "--workspace-accent-strong",
  desktopBrand.colors.accentStrong,
);
document.documentElement.style.setProperty(
  "--workspace-accent-hover",
  desktopBrand.colors.accentHover,
);
document.documentElement.style.setProperty(
  "--workspace-accent-soft",
  desktopBrand.colors.accentSoft,
);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 2_000, retry: 1 },
    mutations: { retry: 0 },
  },
});

if (!root) {
  throw new Error("Renderer root element is missing");
}

function RendererUnavailable({ crashed = false }: { crashed?: boolean }): React.JSX.Element {
  return (
    <main className="bridge-unavailable" role="alert">
      <div>
        <p className="eyebrow">
          {desktopBrand.productName} · {desktopBrand.displayName}
        </p>
        <h1>{crashed ? "界面没有正常启动" : `请从 ${desktopBrand.productName} 桌面应用打开`}</h1>
        <p>
          {crashed
            ? "桌面界面遇到意外错误。你的本机对话数据不会因此被删除。"
            : "当前页面缺少安全桌面桥接，无法直接在普通浏览器中使用。请返回 Electron 应用窗口。"}
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          重新加载界面
        </button>
      </div>
    </main>
  );
}

class RendererErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  render(): ReactNode {
    return this.state.crashed ? <RendererUnavailable crashed /> : this.props.children;
  }
}

const hasDesktopBridge = typeof window.openerx === "object" && window.openerx !== null;

createRoot(root).render(
  <StrictMode>
    <RendererErrorBoundary>
      {hasDesktopBridge ? (
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      ) : (
        <RendererUnavailable />
      )}
    </RendererErrorBoundary>
  </StrictMode>,
);
