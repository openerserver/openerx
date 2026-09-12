import { type ReactNode, useEffect, useRef } from "react";

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pending = false,
  children,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {children}
      </div>
      <div className="confirmation-dialog-actions">
        <button ref={cancelButtonRef} type="button" disabled={pending} onClick={onCancel}>
          取消
        </button>
        <button type="button" className="danger-action" disabled={pending} onClick={onConfirm}>
          {pending ? "处理中…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
