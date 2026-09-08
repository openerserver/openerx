import { randomUUID } from "node:crypto";
import {
  type DesktopControlCommand,
  type DesktopControlOperation,
  type DesktopControlSession,
  type DesktopExecutionContext,
  desktopControlOperationSchema,
  desktopExecutionContextSchema,
  type NormalizedToolResult,
} from "@openerx/contracts";
import type { DesktopControlLease } from "./control-lease";
import {
  assertTargetIdentity,
  type DesktopNativeDriver,
  type NativeElement,
  type NativeObservation,
  type NativeTarget,
} from "./driver";

interface Reference {
  owner: DesktopExecutionContext;
  createdAt: number;
  applicationId: string;
  target?: NativeTarget;
}
interface Observation {
  id: string;
  createdAt: number;
  native: NativeObservation;
  elements: Map<string, NativeElement>;
}
interface Session {
  descriptor: DesktopControlSession;
  owner: DesktopExecutionContext;
  target: NativeTarget;
  lease: ReturnType<DesktopControlLease["acquire"]> | null;
  monitor: { close(): void } | null;
  controller: AbortController;
  observation: Observation | null;
  busy: boolean;
  waitingForResume?: { resolve(): void; reject(error: Error): void };
}

function response(
  summary: string,
  data: Record<string, unknown>,
  committed = false,
  image?: string | null,
): NormalizedToolResult {
  return {
    summary,
    data,
    content: [
      { type: "text", text: `${summary}\n${JSON.stringify(data)}` },
      ...(image ? [{ type: "image" as const, data: image, mimeType: "image/png" }] : []),
    ],
    sources: [],
    artifacts: [],
    durationMs: 0,
    sideEffectCommitted: committed,
  };
}
function sameOwner(a: DesktopExecutionContext, b: DesktopExecutionContext): boolean {
  return a.conversationId === b.conversationId && a.generationId === b.generationId;
}

export class DesktopControlHost {
  readonly #references = new Map<string, Reference>();
  readonly #sessions = new Map<string, Session>();
  constructor(
    private readonly driver: DesktopNativeDriver,
    private readonly lease: DesktopControlLease,
    private readonly now: () => number = Date.now,
    private readonly resumeTimeoutMs = 30_000,
  ) {}

  descriptors(): DesktopControlSession[] {
    return [...this.#sessions.values()].map((s) => structuredClone(s.descriptor));
  }
  async probe(signal: AbortSignal): Promise<void> {
    await this.driver.probe(signal);
  }

  async execute(
    raw: DesktopControlOperation,
    signal: AbortSignal,
    rawOwner?: DesktopExecutionContext,
  ): Promise<NormalizedToolResult> {
    const owner = desktopExecutionContextSchema.parse(rawOwner);
    const operation = desktopControlOperationSchema.parse(raw);
    signal.throwIfAborted();
    if (operation.action === "list_apps") return this.#list(owner, signal);
    if (operation.action === "open_app") {
      this.#reference(operation.appRef, operation.applicationId, owner, false);
      const reservation = this.lease.acquire(`launch:${owner.generationId}`);
      try {
        await this.driver.open(operation.applicationId, signal);
        return response(
          "已启动应用；请重新 list_apps 并 attach 新窗口",
          { applicationId: operation.applicationId },
          true,
        );
      } finally {
        reservation.release();
      }
    }
    if (operation.action === "attach") return this.#attach(operation, owner, signal);
    const session = this.#required(operation.sessionId);
    if (
      !sameOwner(session.owner, owner) ||
      session.target.applicationId !== operation.applicationId
    )
      throw new Error("DESKTOP_SESSION_OWNER_MISMATCH");
    if (operation.action === "detach") {
      this.#pause(session, "DESKTOP_DETACHED", true);
      return response("已释放桌面控制，应用保持打开", { session: session.descriptor });
    }
    if (session.descriptor.state === "paused" || session.descriptor.state === "stopped")
      throw new Error("DESKTOP_USER_RESUME_REQUIRED");
    if (session.busy) throw new Error("DESKTOP_CONTROL_BUSY");
    if (!session.lease) throw new Error("DESKTOP_CONTROL_LEASE_LOST");
    this.lease.assert(session.descriptor.sessionId, session.lease.epoch);
    const activeSignal = AbortSignal.any([signal, session.controller.signal]);
    const abort = () => this.#pause(session, "TOOL_CANCELLED");
    signal.addEventListener("abort", abort, { once: true });
    session.busy = true;
    session.descriptor.state = "controlling";
    try {
      activeSignal.throwIfAborted();
      if (operation.action === "observe") return await this.#observe(session, activeSignal);
      const observation = session.observation;
      if (
        !observation ||
        observation.id !== operation.observationId ||
        this.now() - observation.createdAt > 60_000
      )
        throw new Error("DESKTOP_OBSERVATION_STALE");
      const element =
        "elementRef" in operation ? observation.elements.get(operation.elementRef) : undefined;
      if ("elementRef" in operation && !element) throw new Error("DESKTOP_ELEMENT_STALE");
      if (
        element &&
        (element.sensitive ||
          !element.enabled ||
          !element.actions.includes(operation.action as "invoke" | "set_value" | "type_text"))
      )
        throw new Error("DESKTOP_ACTION_UNSUPPORTED");
      if (
        "x" in operation &&
        (!observation.native.pngBase64 ||
          operation.x >= observation.native.imageWidth ||
          operation.y >= observation.native.imageHeight)
      )
        throw new Error("DESKTOP_COORDINATES_INVALID");
      // Consume before dispatch. A failed/unknown action cannot reuse this snapshot.
      session.observation = null;
      await this.driver.act(
        observation.native.target,
        observation.native,
        operation,
        element,
        activeSignal,
      );
      try {
        return await this.#observe(session, activeSignal, true);
      } catch (error) {
        this.#pause(session, "DESKTOP_RESULT_UNVERIFIED");
        return response(
          "动作已派发，但结果尚未验证。请接管或恢复后重新观察，勿重复发送动作。",
          {
            session: session.descriptor,
            outcome: "dispatched_unverified",
            reason:
              error instanceof Error && /^(DESKTOP_|TOOL_)/u.test(error.message)
                ? error.message
                : "DESKTOP_OBSERVATION_FAILED",
          },
          true,
        );
      }
    } catch (error) {
      session.observation = null;
      if (
        activeSignal.aborted ||
        (error instanceof Error &&
          /DESKTOP_(?:TARGET_NOT_FRONTMOST|USER_|MONITOR_|SESSION_LOCKED|NATIVE_TIMEOUT|HELPER_)/u.test(
            error.message,
          ))
      )
        this.#pause(session, activeSignal.aborted ? "TOOL_CANCELLED" : (error as Error).message);
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      session.busy = false;
      if (session.descriptor.state === "controlling") session.descriptor.state = "ready";
    }
  }

  async #list(owner: DesktopExecutionContext, signal: AbortSignal): Promise<NormalizedToolResult> {
    for (const [id, ref] of this.#references)
      if (this.now() - ref.createdAt > 60_000) this.#references.delete(id);
    const windows = await this.driver.list(signal);
    const add = (applicationId: string, target?: NativeTarget) => {
      const id = randomUUID();
      this.#references.set(id, { owner, createdAt: this.now(), applicationId, target });
      return id;
    };
    const apps = [
      { applicationId: "windows:notepad", name: "记事本", appRef: add("windows:notepad") },
      { applicationId: "windows:calculator", name: "计算器", appRef: add("windows:calculator") },
    ];
    const candidates = windows.map((target) => ({
      applicationId: target.applicationId,
      application: target.application,
      title: target.title,
      windowRef: add(target.applicationId, target),
    }));
    while (this.#references.size > 512)
      this.#references.delete(this.#references.keys().next().value as string);
    return response("可启动应用与当前可访问窗口；使用原样返回的 applicationId 和引用", {
      apps,
      windows: candidates,
      expiresInMs: 60_000,
    });
  }
  #reference(
    id: string,
    applicationId: string,
    owner: DesktopExecutionContext,
    window: boolean,
  ): Reference {
    const ref = this.#references.get(id);
    if (!ref || this.now() - ref.createdAt > 60_000)
      throw new Error("DESKTOP_APPLICATION_REFERENCE_EXPIRED");
    if (
      !sameOwner(ref.owner, owner) ||
      ref.applicationId !== applicationId ||
      Boolean(ref.target) !== window
    )
      throw new Error("DESKTOP_APPLICATION_REFERENCE_MISMATCH");
    return ref;
  }
  async #attach(
    operation: Extract<DesktopControlOperation, { action: "attach" }>,
    owner: DesktopExecutionContext,
    signal: AbortSignal,
  ): Promise<NormalizedToolResult> {
    const target = this.#reference(
      operation.windowRef,
      operation.applicationId,
      owner,
      true,
    ).target;
    if (!target) throw new Error("DESKTOP_TARGET_IDENTITY_MISSING");
    if (
      [...this.#sessions.values()].some(
        (s) =>
          s.owner.conversationId === owner.conversationId &&
          s.target.applicationId === target.applicationId &&
          s.target.windowId === target.windowId &&
          s.descriptor.state === "paused",
      )
    )
      throw new Error("DESKTOP_USER_RESUME_REQUIRED");
    for (const [id, s] of this.#sessions)
      if (s.descriptor.state === "stopped") this.#sessions.delete(id);
    if (this.#sessions.size >= 16) throw new Error("DESKTOP_SESSION_LIMIT");
    const id = randomUUID();
    const session: Session = {
      descriptor: {
        sessionId: id,
        conversationId: owner.conversationId,
        applicationId: target.applicationId,
        application: target.application,
        windowTitle: target.title,
        state: "controlling",
        reason: null,
      },
      owner,
      target,
      lease: this.lease.acquire(id),
      monitor: null,
      controller: new AbortController(),
      observation: null,
      busy: true,
    };
    this.#sessions.set(id, session);
    const abort = () => this.#pause(session, "TOOL_CANCELLED");
    signal.addEventListener("abort", abort, { once: true });
    const activeSignal = AbortSignal.any([signal, session.controller.signal]);
    try {
      try {
        // Arm takeover before activation, which may wait on a slow UIA provider.
        await this.#monitor(session);
        activeSignal.throwIfAborted();
        await this.driver.focus(target, activeSignal);
      } catch (error) {
        if (
          activeSignal.aborted ||
          !(error instanceof Error) ||
          error.message !== "DESKTOP_TARGET_NOT_FRONTMOST"
        )
          throw error;
        // Keep this tool call and its trusted generation alive while the user
        // resumes from the foreground UWA window. Never retry by stealing focus.
        this.#pause(session, "DESKTOP_TARGET_NOT_FRONTMOST");
        session.busy = false;
        await this.#waitForResume(session, signal);
      }
      session.busy = true;
      const resumedSignal = AbortSignal.any([signal, session.controller.signal]);
      resumedSignal.throwIfAborted();
      if (!session.monitor) await this.#monitor(session);
      const observed = await this.#observe(session, resumedSignal);
      session.descriptor.state = "ready";
      return observed;
    } catch (error) {
      this.#pause(session, signal.aborted ? "TOOL_CANCELLED" : "DESKTOP_ATTACH_FAILED", true);
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      session.busy = false;
    }
  }
  async #waitForResume(session: Session, signal: AbortSignal): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        delete session.waitingForResume;
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(new Error("TOOL_CANCELLED"));
      const timer = setTimeout(
        () => finish(new Error("DESKTOP_FOREGROUND_RESUME_TIMEOUT")),
        this.resumeTimeoutMs,
      );
      session.waitingForResume = { resolve: () => finish(), reject: finish };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  async #monitor(session: Session): Promise<void> {
    const monitor = await this.driver.monitor(
      () => this.#pause(session, "DESKTOP_USER_INPUT"),
      () => this.#pause(session, "DESKTOP_MONITOR_LOST"),
      session.controller.signal,
    );
    if (session.controller.signal.aborted) {
      monitor.close();
      throw new Error("DESKTOP_USER_RESUME_REQUIRED");
    }
    session.monitor = monitor;
  }
  async #observe(
    session: Session,
    signal: AbortSignal,
    committed = false,
  ): Promise<NormalizedToolResult> {
    const native = await this.driver.observe(session.target, signal);
    signal.throwIfAborted();
    assertTargetIdentity(session.target, native.target);
    const observation: Observation = {
      id: randomUUID(),
      createdAt: this.now(),
      native,
      elements: new Map(),
    };
    const elements = native.elements.map((element) => {
      const elementRef = randomUUID();
      observation.elements.set(elementRef, element);
      const { runtimeId: _runtimeId, ...data } = element;
      return { elementRef, ...data };
    });
    session.target = native.target;
    session.descriptor.windowTitle = native.target.title;
    session.observation = observation;
    return response(
      committed ? "动作已执行，已取得新观察；请根据新状态验证任务结果" : "已观察目标窗口",
      {
        session: { ...session.descriptor, state: "ready" },
        observation: {
          observationId: observation.id,
          expiresInMs: 60_000,
          elements,
          width: native.imageWidth,
          height: native.imageHeight,
          coordinateSpace: "image_pixels",
          elementBoundsSpace: "screen_physical_pixels",
          windowBounds: native.target.bounds,
          truncated: native.truncated,
        },
        ...(committed ? { outcome: "dispatched_observed" } : {}),
      },
      committed,
      native.pngBase64,
    );
  }
  #required(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session) throw new Error("DESKTOP_SESSION_NOT_FOUND");
    return session;
  }
  #pause(session: Session, reason: string, stopped = false): void {
    if (stopped || reason === "TOOL_CANCELLED") session.waitingForResume?.reject(new Error(reason));
    session.descriptor.state = stopped ? "stopped" : "paused";
    session.descriptor.reason = reason;
    session.observation = null;
    session.controller.abort();
    // A normal detach may be followed by another approved app in this task.
    // User intervention, failure, and task termination discard the input owner.
    if (reason !== "DESKTOP_DETACHED") this.driver.cancelInteractions?.();
    session.monitor?.close();
    session.monitor = null;
    session.lease?.release();
    session.lease = null;
  }
  async control(command: DesktopControlCommand): Promise<DesktopControlSession> {
    const session = this.#required(command.sessionId);
    if (command.action !== "resume") {
      this.#pause(
        session,
        command.action === "stop" ? "DESKTOP_STOPPED_BY_USER" : "DESKTOP_PAUSED_BY_USER",
        command.action === "stop",
      );
      return structuredClone(session.descriptor);
    }
    if (session.descriptor.state !== "paused" || session.busy)
      throw new Error("DESKTOP_RESUME_UNAVAILABLE");
    session.lease = this.lease.acquire(session.descriptor.sessionId);
    session.controller = new AbortController();
    session.busy = true;
    try {
      await this.#monitor(session);
      session.controller.signal.throwIfAborted();
      await this.driver.focus(session.target, session.controller.signal);
      session.controller.signal.throwIfAborted();
      session.descriptor.state = "ready";
      session.descriptor.reason = null;
      session.waitingForResume?.resolve();
      return structuredClone(session.descriptor);
    } catch (error) {
      // A stop command can change this state while native focus is awaited.
      if (this.#required(command.sessionId).descriptor.state !== "stopped")
        this.#pause(session, "DESKTOP_RESUME_FAILED");
      throw error;
    } finally {
      session.busy = false;
    }
  }
  stopAll(reason = "DESKTOP_STOPPED_BY_USER", conversationId?: string): void {
    for (const session of this.#sessions.values())
      if (!conversationId || session.owner.conversationId === conversationId)
        this.#pause(session, reason, true);
  }
  close(): void {
    this.stopAll();
    this.#references.clear();
    this.driver.close();
  }
}
