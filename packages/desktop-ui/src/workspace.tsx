import { CaretDown, Check } from "@phosphor-icons/react";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { composerMenuPosition } from "./composer-menu-position";
import "./workspace.css";

function classes(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

// Edition-specific hosts own data, permissions and execution. These primitives only render UI.
export const WorkspaceShell = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function WorkspaceShell({ className, ...props }, ref) {
    return <div {...props} ref={ref} className={classes("desktop-workspace", className)} />;
  },
);

export type WorkspaceSidebarProps = ComponentPropsWithoutRef<"aside"> & {
  header?: ReactNode;
  footer?: ReactNode;
  scrollProps?: HTMLAttributes<HTMLDivElement> & { "data-testid"?: string };
};

export const WorkspaceSidebar = forwardRef<HTMLElement, WorkspaceSidebarProps>(
  function WorkspaceSidebar({ header, footer, children, scrollProps, className, ...props }, ref) {
    const { className: scrollClassName, ...scrollAttributes } = scrollProps ?? {};
    return (
      <aside
        {...props}
        ref={ref}
        className={classes("sidebar desktop-workspace-sidebar", className)}
      >
        {header != null ? <div className="sidebar-top">{header}</div> : null}
        <div {...scrollAttributes} className={classes("sidebar-scroll", scrollClassName)}>
          {children}
        </div>
        {footer}
      </aside>
    );
  },
);

export const WorkspaceHeader = forwardRef<HTMLElement, ComponentPropsWithoutRef<"header">>(
  function WorkspaceHeader({ className, ...props }, ref) {
    return (
      <header
        {...props}
        ref={ref}
        className={classes("conversation-toolbar desktop-workspace-header", className)}
      />
    );
  },
);

export const WorkspaceThread = forwardRef<HTMLElement, ComponentPropsWithoutRef<"section">>(
  function WorkspaceThread({ className, ...props }, ref) {
    return (
      <section {...props} ref={ref} className={classes("desktop-workspace-thread", className)} />
    );
  },
);

export const WorkspaceComposerFrame = forwardRef<HTMLFormElement, ComponentPropsWithoutRef<"form">>(
  function WorkspaceComposerFrame({ className, ...props }, ref) {
    return (
      <form
        {...props}
        ref={ref}
        className={classes("composer desktop-workspace-composer", className)}
      />
    );
  },
);

export const WorkspaceTextarea = forwardRef<
  HTMLTextAreaElement,
  ComponentPropsWithoutRef<"textarea">
>(function WorkspaceTextarea({ className, onKeyDown, ...props }, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={classes("desktop-workspace-textarea", className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          event.key !== "Enter" ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.repeat ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229 ||
          event.currentTarget.disabled ||
          event.currentTarget.readOnly
        )
          return;
        const form = event.currentTarget.form;
        if (!form) return;
        const submitter = form.querySelector<HTMLButtonElement | HTMLInputElement>(
          'button[type="submit"], input[type="submit"]',
        );
        if (!submitter || submitter.disabled) return;
        event.preventDefault();
        form.requestSubmit(submitter);
      }}
    />
  );
});

export type WorkspaceMessageProps = ComponentPropsWithoutRef<"article"> & {
  kind: "user" | "assistant" | "system";
};

export const WorkspaceMessage = forwardRef<HTMLElement, WorkspaceMessageProps>(
  function WorkspaceMessage({ kind, className, ...props }, ref) {
    return (
      <article
        {...props}
        ref={ref}
        className={classes(`message message-${kind} desktop-workspace-message`, className)}
      />
    );
  },
);

export const WorkspaceInspector = forwardRef<HTMLElement, ComponentPropsWithoutRef<"aside">>(
  function WorkspaceInspector({ className, ...props }, ref) {
    return (
      <aside
        {...props}
        ref={ref}
        className={classes("conversation-rail desktop-workspace-inspector", className)}
      />
    );
  },
);

export type WorkspaceEmptyStateProps = Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
};

export const WorkspaceEmptyState = forwardRef<HTMLElement, WorkspaceEmptyStateProps>(
  function WorkspaceEmptyState(
    { eyebrow, title, titleId, description, children, className, ...props },
    ref,
  ) {
    return (
      <section
        {...props}
        ref={ref}
        className={classes("welcome desktop-workspace-empty", className)}
      >
        {eyebrow != null ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 id={titleId}>{title}</h1>
        {description != null ? <p>{description}</p> : null}
        {children}
      </section>
    );
  },
);

export type WorkspaceMarkdownProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "onCopy"
> & {
  text?: string;
  children?: string;
  onCopy?: (text: string) => void | Promise<void>;
  copied?: boolean;
};

export function WorkspaceMarkdown({
  text,
  children,
  onCopy,
  copied = false,
  className,
  ...props
}: WorkspaceMarkdownProps) {
  return (
    <div {...props} className={classes("markdown-body desktop-workspace-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {linkChildren}
            </a>
          ),
          pre: ({ children: codeChildren }) => (
            <div className="code-block">
              {onCopy ? (
                <button
                  type="button"
                  onClick={(event) => {
                    const code = event.currentTarget.nextElementSibling?.textContent ?? "";
                    void onCopy(code);
                  }}
                >
                  {copied ? "已复制" : "复制代码"}
                </button>
              ) : null}
              <pre>{codeChildren}</pre>
            </div>
          ),
        }}
      >
        {text ?? children ?? ""}
      </ReactMarkdown>
    </div>
  );
}

export type WorkspacePreviewContent = {
  displayName: string;
  format: string;
  source: string | null;
  parsedText: string;
  imageDataUrl: string | null;
  htmlPreviewUrl?: string;
  renderedSurfaces: readonly {
    kind: string;
    index: number;
    label: string;
    imageDataUrl: string;
  }[];
};

export type WorkspaceContentPreviewProps = {
  preview: WorkspacePreviewContent;
  previewMode: "preview" | "source";
  ariaLabel: string;
};

export function WorkspaceContentPreview({
  preview,
  previewMode,
  ariaLabel,
}: WorkspaceContentPreviewProps) {
  if (preview.renderedSurfaces.length > 0 && previewMode === "preview") {
    return (
      <section
        className="office-preview-surfaces desktop-workspace-preview-office"
        aria-label={ariaLabel}
      >
        {preview.renderedSurfaces.map((surface) => (
          <figure key={`${surface.kind}-${surface.index}`}>
            <figcaption>{surface.label}</figcaption>
            <img src={surface.imageDataUrl} alt={`${preview.displayName} ${surface.label}`} />
          </figure>
        ))}
      </section>
    );
  }

  if (preview.imageDataUrl && previewMode === "preview") {
    return (
      <img
        className="standalone-image-preview desktop-workspace-preview-image"
        src={preview.imageDataUrl}
        alt={preview.displayName}
      />
    );
  }

  if (preview.format === "html" && previewMode === "preview" && preview.source) {
    return (
      <iframe
        className="desktop-workspace-preview-html"
        title="HTML 隔离预览"
        sandbox={preview.htmlPreviewUrl ? "allow-scripts allow-same-origin" : "allow-scripts"}
        referrerPolicy="no-referrer"
        src={preview.htmlPreviewUrl}
        srcDoc={preview.htmlPreviewUrl ? undefined : preview.source}
      />
    );
  }

  if (preview.format === "markdown" && previewMode === "preview") {
    return (
      <WorkspaceMarkdown
        className="artifact-markdown-preview desktop-workspace-preview-markdown"
        text={preview.parsedText || preview.source || "没有可提取的文字。"}
      />
    );
  }

  return (
    <pre className="desktop-workspace-preview-source">
      {previewMode === "source"
        ? preview.source || preview.parsedText || "没有可提取的文字。"
        : preview.parsedText || preview.source || "没有可提取的文字。"}
    </pre>
  );
}

export type ComposerSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type ComposerSelectGroup = {
  label: string;
  options: readonly ComposerSelectOption[];
};

export function ComposerSelect({
  ariaLabel,
  className = "",
  disabled = false,
  icon,
  id,
  label,
  onChange,
  onOpen,
  options,
  groups,
  renderNativeSelect = true,
  selectedValues,
  title,
  value,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  id?: string;
  label: string;
  onChange: (value: string) => void;
  onOpen?: () => void;
  options?: readonly ComposerSelectOption[];
  groups?: readonly ComposerSelectGroup[];
  renderNativeSelect?: boolean;
  selectedValues?: readonly string[];
  title?: string;
  value: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<ReturnType<typeof composerMenuPosition> | null>(
    null,
  );
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openingFocusRef = useRef<"selected" | "first" | "last">("selected");
  const menuId = useId();
  const normalizedGroups = useMemo(
    () => groups ?? [{ label: "", options: options ?? [] }],
    [groups, options],
  );
  const flattenedOptions = useMemo(
    () => normalizedGroups.flatMap((group) => group.options),
    [normalizedGroups],
  );
  const activeValues = useMemo(() => selectedValues ?? [value], [selectedValues, value]);
  const enabledIndexes = useMemo(
    () => flattenedOptions.flatMap((option, index) => (option.disabled ? [] : [index])),
    [flattenedOptions],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    const positionMenu = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const viewport = window.visualViewport;
      const next = composerMenuPosition(
        trigger.getBoundingClientRect(),
        {
          width: menu.offsetWidth || menu.getBoundingClientRect().width,
          height: menu.scrollHeight + 2,
        },
        {
          left: viewport?.offsetLeft ?? 0,
          top: viewport?.offsetTop ?? 0,
          width: viewport?.width ?? (document.documentElement.clientWidth || window.innerWidth),
          height: viewport?.height ?? window.innerHeight,
        },
      );
      setMenuPosition((previous) =>
        previous &&
        Object.entries(next).every(
          ([key, value]) => previous[key as keyof typeof previous] === value,
        )
          ? previous
          : next,
      );
    };
    positionMenu();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionMenu);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (menuRef.current) observer?.observe(menuRef.current);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    window.visualViewport?.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("scroll", positionMenu);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      window.visualViewport?.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("scroll", positionMenu);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = flattenedOptions.findIndex(
      (option) => activeValues.includes(option.value) && !option.disabled,
    );
    const targetIndex =
      openingFocusRef.current === "first"
        ? enabledIndexes[0]
        : openingFocusRef.current === "last"
          ? enabledIndexes.at(-1)
          : selectedIndex >= 0
            ? selectedIndex
            : enabledIndexes[0];
    const frame = window.requestAnimationFrame(() => {
      if (targetIndex !== undefined) optionRefs.current[targetIndex]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeValues, enabledIndexes, flattenedOptions, open]);

  const openMenu = (focus: "selected" | "first" | "last" = "selected") => {
    if (disabled || enabledIndexes.length === 0) return;
    onOpen?.();
    openingFocusRef.current = focus;
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveOptionFocus = (currentIndex: number, direction: 1 | -1) => {
    const position = enabledIndexes.indexOf(currentIndex);
    const nextPosition = (position + direction + enabledIndexes.length) % enabledIndexes.length;
    const nextIndex = enabledIndexes[nextPosition];
    if (nextIndex !== undefined) optionRefs.current[nextIndex]?.focus();
  };

  const leaveMenu = (backward: boolean) => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, summary, [tabindex]",
      ),
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled, [hidden], [aria-hidden="true"]') &&
        !element.closest("[inert], [hidden]") &&
        !menuRef.current?.contains(element) &&
        getComputedStyle(element).display !== "none" &&
        getComputedStyle(element).visibility !== "hidden",
    );
    const index = triggerRef.current ? controls.indexOf(triggerRef.current) : -1;
    const next = backward ? triggerRef.current : controls[index + 1];
    closeMenu();
    window.requestAnimationFrame(() => (next ?? triggerRef.current)?.focus());
  };

  return (
    <div
      ref={rootRef}
      className={`composer-select desktop-workspace-select ${open ? "is-open" : ""} ${className}`.trim()}
      title={title}
    >
      <button
        ref={triggerRef}
        type="button"
        className="composer-select-trigger"
        aria-label={`${ariaLabel}菜单`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowDown" ? "first" : "last");
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
      >
        {icon}
        <span className="composer-select-label">{label}</span>
        <CaretDown className="composer-select-caret" size={13} weight="bold" aria-hidden="true" />
      </button>
      {renderNativeSelect ? (
        <select
          id={id}
          className="composer-native-select"
          aria-label={ariaLabel}
          tabIndex={-1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {flattenedOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="composer-select-menu desktop-workspace-select-menu"
              role="listbox"
              aria-label={ariaLabel}
              data-placement={menuPosition?.placement}
              style={
                menuPosition
                  ? {
                      left: menuPosition.left,
                      top: menuPosition.top,
                      minWidth: menuPosition.minWidth,
                      maxWidth: menuPosition.maxWidth,
                      maxHeight: menuPosition.maxHeight,
                    }
                  : { visibility: "hidden" }
              }
            >
              {normalizedGroups.map((group, groupIndex) => {
                const offset = normalizedGroups
                  .slice(0, groupIndex)
                  .reduce((total, current) => total + current.options.length, 0);
                return (
                  <div className="composer-select-group" key={group.label || "options"}>
                    {group.label ? (
                      <span className="composer-select-group-label">{group.label}</span>
                    ) : null}
                    {group.options.map((option, optionIndex) => {
                      const index = offset + optionIndex;
                      const selected = activeValues.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          ref={(element) => {
                            optionRefs.current[index] = element;
                          }}
                          type="button"
                          className={`composer-select-option ${selected ? "is-selected" : ""}`}
                          role="option"
                          aria-selected={selected}
                          aria-disabled={option.disabled || undefined}
                          disabled={option.disabled}
                          onClick={() => {
                            if (option.disabled) return;
                            if (!selected) onChange(option.value);
                            closeMenu(true);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                              event.preventDefault();
                              moveOptionFocus(index, event.key === "ArrowDown" ? 1 : -1);
                            } else if (event.key === "Home" || event.key === "End") {
                              event.preventDefault();
                              const target =
                                event.key === "Home" ? enabledIndexes[0] : enabledIndexes.at(-1);
                              if (target !== undefined) optionRefs.current[target]?.focus();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              closeMenu(true);
                            } else if (event.key === "Tab") {
                              event.preventDefault();
                              leaveMenu(event.shiftKey);
                            }
                          }}
                        >
                          <span className="composer-select-option-copy">
                            <strong>{option.label}</strong>
                            {option.description ? <small>{option.description}</small> : null}
                          </span>
                          <span className="composer-select-check" aria-hidden="true">
                            {selected ? <Check size={15} weight="bold" /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
