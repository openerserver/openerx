import { AsyncLocalStorage } from "node:async_hooks";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCodemodeSource } from "@earendil-works/pi-codemode/source";
import {
  type AgentToolResult,
  createCodemodeExtension,
  createToolSearchExtension,
  type ExtensionAPI,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { sanitizeProductStructuredContent } from "./tool-result";
import { createProductToolSearch } from "./tool-search";

export interface ProductToolCallContext {
  toolCallId: string;
  parentToolCallId?: string;
  signal?: AbortSignal;
}

export interface ControlledNativeToolOptions {
  timeoutMs?: number;
  maxCodeBytes?: number;
  maxOutputTokens?: number;
  maxNestedCalls?: number;
  maxConcurrency?: number;
}

const hardLimits = {
  timeoutMs: 60_000,
  maxCodeBytes: 64 * 1024,
  maxOutputTokens: 10_000,
  maxNestedCalls: 64,
  maxConcurrency: 8,
} as const;

type NativeLimits = { -readonly [Key in keyof typeof hardLimits]: number };

interface CallBudget {
  calls: number;
  running: number;
  queue: Array<() => void>;
}

interface SessionToolState {
  parents: Map<string, string>;
  budgets: Map<string, CallBudget>;
  limits: NativeLimits;
}

const callContext = new AsyncLocalStorage<ProductToolCallContext>();
const sessionStates = new WeakMap<object, SessionToolState>();
const labelsBySchema = new WeakMap<object, Map<string, string>>();
const jsonOutputSchema = Type.Unknown();

export function getProductToolCallContext(): ProductToolCallContext | undefined {
  return callContext.getStore();
}

function stateFor(sessionManager: object): SessionToolState {
  let state = sessionStates.get(sessionManager);
  if (!state) {
    state = { parents: new Map(), budgets: new Map(), limits: { ...hardLimits } };
    sessionStates.set(sessionManager, state);
  }
  return state;
}

function limitsFor(options: ControlledNativeToolOptions): NativeLimits {
  const limits: NativeLimits = { ...hardLimits };
  for (const key of Object.keys(hardLimits) as Array<keyof NativeLimits>) {
    const value = options[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("PI_NATIVE_LIMIT_INVALID");
    limits[key] = Math.min(value, hardLimits[key]);
  }
  return limits;
}

function combinedSignal(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const present = [...new Set(signals.filter((signal): signal is AbortSignal => !!signal))];
  return present.length > 1 ? AbortSignal.any(present) : present[0];
}

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("TOOL_CANCELLED");
}

function budgetFor(state: SessionToolState, parent: string): CallBudget {
  let budget = state.budgets.get(parent);
  if (!budget) {
    budget = { calls: 0, running: 0, queue: [] };
    state.budgets.set(parent, budget);
  }
  return budget;
}

async function enterBudget(
  budget: CallBudget,
  maximum: number,
  signal?: AbortSignal,
): Promise<() => void> {
  checkSignal(signal);
  if (budget.running >= maximum) {
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        const index = budget.queue.indexOf(ready);
        if (index !== -1) budget.queue.splice(index, 1);
        reject(new Error("TOOL_CANCELLED"));
      };
      budget.queue.push(ready);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  } else {
    budget.running += 1;
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const next = budget.queue.shift();
    if (next) next();
    else budget.running -= 1;
  };
  try {
    checkSignal(signal);
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

/** Each tool keeps its own signal/context when a script dispatches calls in parallel. */
export function wrapControlledProductTools(
  tools: ToolDefinition[],
  options: { nativeToolsEnabled?: boolean } = {},
): ToolDefinition[] {
  return tools.map((tool) => {
    let labels = labelsBySchema.get(tool.parameters);
    if (!labels) {
      labels = new Map();
      labelsBySchema.set(tool.parameters, labels);
    }
    labels.set(tool.name, tool.label);
    return {
      ...tool,
      ...(options.nativeToolsEnabled
        ? { exposure: tool.exposure ?? "deferred", defaultActive: false }
        : {}),
      outputSchema: tool.outputSchema ?? jsonOutputSchema,
      execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        const state = ctx?.sessionManager ? stateFor(ctx.sessionManager) : undefined;
        const parentToolCallId = state?.parents.get(toolCallId);
        const inherited = callContext.getStore();
        const effectiveSignal = combinedSignal([
          signal,
          ctx?.signal,
          inherited?.toolCallId !== toolCallId ? inherited?.signal : undefined,
        ]);
        const budget = parentToolCallId && state ? budgetFor(state, parentToolCallId) : undefined;
        const release = budget
          ? await enterBudget(
              budget,
              state?.limits.maxConcurrency ?? hardLimits.maxConcurrency,
              effectiveSignal,
            )
          : undefined;
        try {
          checkSignal(effectiveSignal);
          return await callContext.run(
            {
              toolCallId,
              ...(parentToolCallId ? { parentToolCallId } : {}),
              signal: effectiveSignal,
            },
            async () => {
              const result = await tool.execute(toolCallId, params, effectiveSignal, onUpdate, ctx);
              checkSignal(effectiveSignal);
              return {
                ...result,
                // Native codemode returns structured errors as values (MCP's convention).
                // Product tools use exceptions for failures, so an error must not become data.
                structuredContent: result.isError
                  ? undefined
                  : sanitizeProductStructuredContent(
                      result.structuredContent === undefined
                        ? result.details
                        : result.structuredContent,
                    ),
              };
            },
          );
        } finally {
          release?.();
          state?.parents.delete(toolCallId);
        }
      },
    };
  });
}

function controlledSource(source: unknown, limits: NativeLimits): string {
  if (typeof source !== "string") throw new Error("PI_NATIVE_CODE_INVALID");
  if (Buffer.byteLength(source, "utf8") > limits.maxCodeBytes) {
    throw new Error("PI_NATIVE_CODE_LIMIT");
  }
  const parsed = parseCodemodeSource(source);
  return `// @options: ${JSON.stringify({
    timeout_ms: Math.min(parsed.options.timeoutMs ?? limits.timeoutMs, limits.timeoutMs),
    max_output_tokens: Math.min(
      parsed.options.maxOutputTokens ?? limits.maxOutputTokens,
      limits.maxOutputTokens,
    ),
  })}\n${parsed.code}`;
}

function replaceSpillPath(text: string, spillPath?: string): string {
  return spillPath ? text.split(spillPath).join("<discarded-script-output>") : text;
}

async function cleanNativeResult(
  result: AgentToolResult<unknown>,
): Promise<AgentToolResult<unknown>> {
  const details =
    result.details && typeof result.details === "object"
      ? (result.details as Record<string, unknown>)
      : {};
  const spillPath = typeof details.fullOutputPath === "string" ? details.fullOutputPath : undefined;
  // Pi owns this random spill file; never remove a path supplied by a product tool or a script.
  if (
    spillPath &&
    path.dirname(spillPath) === tmpdir() &&
    /^pi-codemode-[a-f0-9]{16}\.txt$/u.test(path.basename(spillPath))
  ) {
    await rm(spillPath, { force: true });
  }
  let remaining = 64 * 1024;
  const content = result.content.flatMap<AgentToolResult<unknown>["content"][number]>((part) => {
    if (part.type === "image") {
      const bytes = Buffer.byteLength(part.data, "utf8");
      if (bytes > remaining) return [];
      remaining -= bytes;
      return [part];
    }
    const text = replaceSpillPath(part.text, spillPath);
    const bounded = Buffer.from(text, "utf8")
      .subarray(0, remaining)
      .toString("utf8")
      .replace(/\uFFFD$/u, "");
    remaining = Math.max(0, remaining - Buffer.byteLength(bounded, "utf8"));
    return bounded ? [{ type: "text" as const, text: bounded }] : [];
  });
  const { fullOutputPath: _discarded, ...metadata } = details;
  return { ...result, content, details: sanitizeProductStructuredContent(metadata) };
}

function wrapCodemode(definition: ToolDefinition, limits: NativeLimits): ToolDefinition {
  return {
    ...definition,
    defaultActive: false,
    promptGuidelines: [
      ...(definition.promptGuidelines ?? []),
      "Scripts have a 60-second hard deadline and bounded code, output, tool calls, and concurrency. store()/load() are temporary within one script; they are never saved to the session.",
    ],
    prepareLoadout: (loadout) => {
      const prepared = definition.prepareLoadout?.(loadout);
      const description = prepared?.descriptions?.codemode;
      return description
        ? {
            ...prepared,
            descriptions: {
              ...prepared.descriptions,
              codemode: description.replace(
                "`store(key, value)` and `load(key)` keep JSON values across codemode calls.",
                "`store(key, value)` and `load(key)` are temporary within one script and are never saved.",
              ),
            },
          }
        : prepared;
    },
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const state = stateFor(ctx.sessionManager);
      state.limits = limits;
      state.budgets.set(toolCallId, { calls: 0, running: 0, queue: [] });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
      const effectiveSignal = combinedSignal([signal, ctx.signal, controller.signal]);
      try {
        checkSignal(effectiveSignal);
        const code = controlledSource((params as { code?: unknown }).code, limits);
        const result = await callContext.run({ toolCallId, signal: effectiveSignal }, () =>
          definition.execute(toolCallId, { code }, effectiveSignal, onUpdate, ctx),
        );
        return await cleanNativeResult(result);
      } finally {
        clearTimeout(timeout);
        controller.abort();
        state.budgets.delete(toolCallId);
        for (const [child, parent] of state.parents) {
          if (parent === toolCallId) state.parents.delete(child);
        }
      }
    },
  };
}

function registerLegacySearch(pi: ExtensionAPI): void {
  const controller = {
    active: () => pi.getActiveTools(),
    activate: (toolNames: string[]) => pi.setActiveTools(toolNames),
  };
  const empty = createProductToolSearch([], controller);
  pi.registerTool({
    ...empty,
    exposure: "model-only",
    defaultActive: false,
    execute: async (id, params, signal, onUpdate, ctx) => {
      const tools: ToolDefinition[] = pi
        .getAllTools()
        .filter(
          (tool) =>
            tool.exposure !== "hidden" &&
            !["codemode", "tool_search", "openerx_tool_search"].includes(tool.name),
        )
        .map((tool) => ({
          ...tool,
          label: labelsBySchema.get(tool.parameters)?.get(tool.name) ?? tool.name,
          execute: async () => ({ content: [], details: null }),
        }));
      return await createProductToolSearch(tools, controller).execute(
        id,
        params,
        signal,
        onUpdate,
        ctx,
      );
    },
  });
}

/** Only these bundled factories are installed; filesystem extension discovery remains disabled. */
export function createControlledNativeExtensions(
  options: ControlledNativeToolOptions = {},
): ExtensionFactory[] {
  const limits = limitsFor(options);
  return [
    (pi) => {
      const controlledApi: ExtensionAPI = {
        ...pi,
        registerTool: (definition) =>
          pi.registerTool(
            wrapCodemode(definition as unknown as ToolDefinition, limits) as typeof definition,
          ),
        appendEntry: (customType, data) => {
          if (customType !== "codemode-store") pi.appendEntry(customType, data);
        },
      };
      createCodemodeExtension({ models: false, mode: "on" })(controlledApi);
      createToolSearchExtension()(pi);
      registerLegacySearch(pi);
      pi.on("tool_call", (event, ctx) => {
        const state = stateFor(ctx.sessionManager);
        state.limits = limits;
        if (!event.parentToolCallId) return;
        state.parents.set(event.toolCallId, event.parentToolCallId);
        const budget = budgetFor(state, event.parentToolCallId);
        budget.calls += 1;
        if (budget.calls > limits.maxNestedCalls) {
          return { block: true, reason: "PI_NATIVE_TOOL_CALL_LIMIT" };
        }
      });
      pi.on("tool_result", (event, ctx) => {
        stateFor(ctx.sessionManager).parents.delete(event.toolCallId);
      });
      pi.on("session_shutdown", (_event, ctx) => {
        sessionStates.delete(ctx.sessionManager);
      });
    },
  ];
}
