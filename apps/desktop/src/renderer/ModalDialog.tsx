import { type ReactNode, useLayoutEffect, useRef } from "react";

const focusable =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Shared modal keyboard behavior, including nested dialogs and focus restoration. */
export function ModalDialog({
  children,
  className,
  titleId,
  onClose,
  pending = false,
}: {
  children: ReactNode;
  className: string;
  titleId: string;
  onClose: () => void;
  pending?: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const current = useRef({ onClose, pending });
  current.current = { onClose, pending };
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const blocked: HTMLElement[] = [];
    let node: HTMLElement = dialog;
    while (node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (
          sibling instanceof HTMLElement &&
          sibling !== node &&
          !sibling.inert &&
          !sibling.hasAttribute("inert")
        ) {
          sibling.inert = true;
          sibling.setAttribute("inert", "");
          blocked.push(sibling);
        }
      }
      node = node.parentElement;
      if (node === document.body) break;
    }
    const fields = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusable))
        .filter(
          (element) =>
            !element.matches(":disabled") &&
            !element.closest('[hidden], [aria-hidden="true"], [inert]'),
        )
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1));
    const focusFirst = () =>
      (
        dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
        fields()[0] ??
        dialog
      ).focus();
    const topmost = () =>
      !dialog.inert &&
      !dialog.closest("[inert]") &&
      !dialog.querySelector('[role="dialog"][aria-modal="true"]');
    const keydown = (event: KeyboardEvent) => {
      if (!topmost()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!current.current.pending) current.current.onClose();
      } else if (event.key === "Tab") {
        const items = fields(),
          first = items[0],
          last = items.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (
          !dialog.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const contain = (event: FocusEvent) => {
      if (topmost() && event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    focusFirst();
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", contain);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", contain);
      for (const element of blocked) {
        element.inert = false;
        element.removeAttribute("inert");
      }
      if (previous?.isConnected && !previous.closest("[inert]")) previous.focus();
    };
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}
