import type { DesktopBridge, PersonalFile } from "@openerx/contracts";
import {
  desktopWorkspaceBridge,
  desktopWorkspaceDraftScope,
} from "@openerx/desktop-ui/workspace-bridge";
import { type Dispatch, type SetStateAction, useState } from "react";

type Draft = { text: string; files: PersonalFile[] };
type ScopedDraft = Draft & { bridge: DesktopBridge; target: string };
const drafts = new WeakMap<object, Map<string, Draft>>();

function read(bridge: DesktopBridge, target: string): ScopedDraft {
  const saved = drafts.get(desktopWorkspaceDraftScope(bridge))?.get(target);
  return { bridge, target, text: saved?.text ?? "", files: saved?.files ?? [] };
}

/** Drafts follow a verified workspace identity and task, and stay in this process only. */
export function useWorkspaceComposerDraft(target: string): {
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  pendingFiles: PersonalFile[];
  setPendingFiles: Dispatch<SetStateAction<PersonalFile[]>>;
} {
  const bridge = desktopWorkspaceBridge();
  const [state, setState] = useState(() => read(bridge, target));
  const current = state.bridge === bridge && state.target === target ? state : read(bridge, target);
  // A replaced bridge must never render or persist the previous workspace's draft.
  if (current !== state) setState(current);
  const update = (change: (saved: ScopedDraft) => ScopedDraft): void => {
    // Late callbacks from a disposed enterprise adapter cannot change another scope.
    if (desktopWorkspaceBridge() !== bridge) return;
    const next = change(read(bridge, target));
    const scope = desktopWorkspaceDraftScope(bridge);
    let saved = drafts.get(scope);
    if (!saved) {
      saved = new Map();
      drafts.set(scope, saved);
    }
    if (!next.text && next.files.length === 0) saved.delete(target);
    else saved.set(target, { text: next.text, files: [...next.files] });
    // Save before rendering: an immediate navigation or model-scope remount must see this edit.
    setState((previous) =>
      previous.bridge === bridge && previous.target === target ? next : previous,
    );
  };
  return {
    draft: current.text,
    pendingFiles: current.files,
    setDraft: (value) =>
      update((saved) => ({
        ...saved,
        text: typeof value === "function" ? value(saved.text) : value,
      })),
    setPendingFiles: (value) =>
      update((saved) => ({
        ...saved,
        files: typeof value === "function" ? value(saved.files) : value,
      })),
  };
}
