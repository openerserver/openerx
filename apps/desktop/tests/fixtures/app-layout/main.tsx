import {
  enterpriseWorkspaceCapabilities,
  setDesktopWorkspaceBridge,
} from "@openerx/desktop-ui/workspace-bridge";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "../../../src/renderer/App";
import { createLayoutBridge, fixtureModel } from "./bridge";
import "../../../src/renderer/styles.css";
import "../../../src/renderer/projects/projects.css";

const params = new URLSearchParams(location.search);
const fixture = createLayoutBridge({
  fileFailure: params.has("files-fail"),
  toolFailure: params.has("tools-fail"),
});
Object.defineProperty(window, "openerx", { configurable: true, value: fixture.bridge });
setDesktopWorkspaceBridge(fixture.bridge, undefined, enterpriseWorkspaceCapabilities);
Object.assign(window, { __appLayoutFixture: fixture });
localStorage.setItem("openerx.defaultModelRef", fixtureModel.modelRef);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 2000 }, mutations: { retry: false } },
});
const root = document.getElementById("root");
if (!root) throw Error("App layout fixture root missing");
createRoot(root).render(
  <QueryClientProvider client={client}>
    <HashRouter>
      <App />
    </HashRouter>
  </QueryClientProvider>,
);
