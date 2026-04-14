import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { useTaskDetailSidebarPaneFeature } from "./useTaskDetailSidebarPaneFeature";

describe("useTaskDetailSidebarPaneFeature", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  it("collects sidebar-specific display state behind a single feature boundary", () => {
    scope = effectScope();
    const sidebar = scope.run(() =>
      useTaskDetailSidebarPaneFeature({
        collapsed: ref(false),
        filePreview: {
          handleCloseFilePreview: () => undefined,
          previewFile: ref({ filePath: "/tmp/demo.txt", content: "hello" }),
        },
        member: {
          memberView: ref(null),
          memberViewLoading: ref(true),
        },
        trace: {
          selectedSessionId: ref("session-1"),
          taskId: ref("task-1"),
          traceRefreshKey: ref(3),
        },
        toggleSidebar: () => undefined,
      }),
    );

    if (!sidebar) {
      throw new Error("expected sidebar pane feature");
    }

    expect(sidebar.showSidebarContent.value).toBe(true);
    expect(sidebar.showFilePreview.value).toBe(true);
    expect(sidebar.showMemberPanel.value).toBe(true);
    expect(sidebar.taskId.value).toBe("task-1");
    expect(sidebar.selectedSessionId.value).toBe("session-1");
  });
});