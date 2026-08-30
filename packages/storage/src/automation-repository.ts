import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type AutomationCreateInput,
  type AutomationDefinition,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationSchedulePreview,
  type AutomationSchedulePreviewInput,
  type AutomationUpdateInput,
  automationCreateInputSchema,
  automationDefinitionSchema,
  automationRunSchema,
  automationSchedulePreviewInputSchema,
  automationUpdateInputSchema,
} from "@openerx/contracts";
import { migrateDatabase } from "./migrations";

type SqlRow = Record<string, unknown>;

export interface AutomationRepositoryOptions {
  ownerProfileId?: string;
  now?: () => string;
  idFactory?: () => string;
}

export interface AutomationDueOptions {
  now?: string;
  forceMissed?: boolean;
}

const activeRunStatuses: AutomationRunStatus[] = [
  "scheduled",
  "claimed",
  "starting",
  "running",
  "retry_scheduled",
];

interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error("AUTOMATION_TIMEZONE_INVALID");
  }
}

function validateAutomationTarget(
  kind: AutomationDefinition["kind"],
  target: AutomationDefinition["target"],
): void {
  if (kind === "heartbeat" && !target.conversationId) {
    throw new Error("AUTOMATION_HEARTBEAT_TARGET_REQUIRED");
  }
}

function zonedDateTimeParts(instantMs: number, timeZone: string): ZonedDateTimeParts {
  const parts = new Map(
    new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instantMs))
      .map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.get("year")),
    month: Number(parts.get("month")),
    day: Number(parts.get("day")),
    hour: Number(parts.get("hour")),
    minute: Number(parts.get("minute")),
    second: Number(parts.get("second")),
    millisecond: new Date(instantMs).getUTCMilliseconds(),
  };
}

function naiveInstant(parts: ZonedDateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function sameLocalTime(left: ZonedDateTimeParts, right: ZonedDateTimeParts): boolean {
  return naiveInstant(left) === naiveInstant(right);
}

function exactInstantsForLocalTime(parts: ZonedDateTimeParts, timeZone: string): number[] {
  const target = naiveInstant(parts);
  const offsets = new Set<number>();
  for (const probe of [target - 2 * 86_400_000, target, target + 2 * 86_400_000]) {
    offsets.add(naiveInstant(zonedDateTimeParts(probe, timeZone)) - probe);
  }
  const matches: number[] = [];
  for (const offset of offsets) {
    const candidate = target - offset;
    if (sameLocalTime(zonedDateTimeParts(candidate, timeZone), parts)) matches.push(candidate);
  }
  return matches.sort((left, right) => left - right);
}

function localTimeToInstant(parts: ZonedDateTimeParts, timeZone: string): number {
  const exact = exactInstantsForLocalTime(parts, timeZone);
  if (exact[0] !== undefined) return exact[0];
  const nominal = naiveInstant(parts);
  for (let minute = 1; minute <= 180; minute += 1) {
    const shifted = new Date(nominal + minute * 60_000);
    const next: ZonedDateTimeParts = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
      millisecond: shifted.getUTCMilliseconds(),
    };
    const matches = exactInstantsForLocalTime(next, timeZone);
    if (matches[0] !== undefined) return matches[0];
  }
  throw new Error("AUTOMATION_TIME_INVALID");
}

function addCalendarDays(parts: ZonedDateTimeParts, days: number): ZonedDateTimeParts {
  const shifted = new Date(naiveInstant(parts));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  };
}

function calendarDay(parts: ZonedDateTimeParts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

function rruleParts(expression: string): Map<string, string> {
  const normalized = expression.toUpperCase().replace(/^RRULE:/u, "");
  const parts = new Map<string, string>();
  for (const item of normalized.split(";")) {
    const [key, value, extra] = item.split("=");
    if (!key || !value || extra !== undefined) throw new Error("AUTOMATION_RRULE_INVALID");
    parts.set(key, value);
  }
  const frequency = parts.get("FREQ");
  if (frequency !== "DAILY" && frequency !== "WEEKLY") {
    throw new Error("AUTOMATION_RRULE_UNSUPPORTED");
  }
  const interval = Number(parts.get("INTERVAL") ?? "1");
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
    throw new Error("AUTOMATION_RRULE_INVALID");
  }
  for (const key of parts.keys()) {
    if (!["FREQ", "INTERVAL", "COUNT", "UNTIL"].includes(key)) {
      throw new Error("AUTOMATION_RRULE_UNSUPPORTED");
    }
  }
  return parts;
}

export function nextAutomationRunAt(
  schedule: AutomationDefinition["schedule"],
  after: string,
): string | null {
  validateTimeZone(schedule.timezone);
  const afterMs = Date.parse(after);
  const startMs = Date.parse(schedule.startAt);
  if (Number.isNaN(afterMs) || Number.isNaN(startMs)) throw new Error("AUTOMATION_TIME_INVALID");
  if (schedule.mode === "once") {
    const scheduled = Date.parse(schedule.expression);
    if (Number.isNaN(scheduled)) throw new Error("AUTOMATION_TIME_INVALID");
    return scheduled > afterMs ? new Date(scheduled).toISOString() : null;
  }
  const parts = rruleParts(schedule.expression);
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const periodDays = (parts.get("FREQ") === "WEEKLY" ? 7 : 1) * interval;
  const count = parts.has("COUNT") ? Number(parts.get("COUNT")) : null;
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 100_000)) {
    throw new Error("AUTOMATION_RRULE_INVALID");
  }
  const untilMs = parts.has("UNTIL") ? Date.parse(String(parts.get("UNTIL"))) : null;
  if (untilMs !== null && Number.isNaN(untilMs)) throw new Error("AUTOMATION_RRULE_INVALID");
  const startLocal = zonedDateTimeParts(startMs, schedule.timezone);
  const afterLocal = zonedDateTimeParts(afterMs, schedule.timezone);
  let occurrence = Math.max(
    0,
    Math.floor((calendarDay(afterLocal) - calendarDay(startLocal)) / periodDays),
  );
  let candidate =
    occurrence === 0
      ? startMs
      : localTimeToInstant(addCalendarDays(startLocal, occurrence * periodDays), schedule.timezone);
  while (candidate <= afterMs) {
    occurrence += 1;
    if (count !== null && occurrence >= count) return null;
    candidate = localTimeToInstant(
      addCalendarDays(startLocal, occurrence * periodDays),
      schedule.timezone,
    );
  }
  if (count !== null && occurrence >= count) return null;
  if (untilMs !== null && candidate > untilMs) return null;
  return new Date(candidate).toISOString();
}

export function previewAutomationRunTimes(
  schedule: AutomationDefinition["schedule"],
  after: string,
  count = 5,
): string[] {
  const occurrences: string[] = [];
  let cursor = after;
  for (let index = 0; index < Math.max(1, Math.min(20, count)); index += 1) {
    const next = nextAutomationRunAt(schedule, cursor);
    if (!next) break;
    occurrences.push(next);
    cursor = next;
  }
  return occurrences;
}

export function latestAutomationRunAt(
  schedule: AutomationDefinition["schedule"],
  firstOccurrence: string,
  through: string,
): string | null {
  const firstMs = Date.parse(firstOccurrence);
  const throughMs = Date.parse(through);
  if (Number.isNaN(firstMs) || Number.isNaN(throughMs)) {
    throw new Error("AUTOMATION_TIME_INVALID");
  }
  if (firstMs > throughMs) return null;
  if (schedule.mode === "once") return new Date(firstMs).toISOString();
  validateTimeZone(schedule.timezone);
  const startMs = Date.parse(schedule.startAt);
  if (Number.isNaN(startMs)) throw new Error("AUTOMATION_TIME_INVALID");
  const parts = rruleParts(schedule.expression);
  const untilMs = parts.has("UNTIL") ? Date.parse(String(parts.get("UNTIL"))) : null;
  if (untilMs !== null && Number.isNaN(untilMs)) throw new Error("AUTOMATION_RRULE_INVALID");
  const upperBoundMs = untilMs === null ? throughMs : Math.min(throughMs, untilMs);
  if (upperBoundMs < startMs) return null;
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const periodDays = (parts.get("FREQ") === "WEEKLY" ? 7 : 1) * interval;
  const startLocal = zonedDateTimeParts(startMs, schedule.timezone);
  const upperBoundLocal = zonedDateTimeParts(upperBoundMs, schedule.timezone);
  let occurrence = Math.max(
    0,
    Math.floor((calendarDay(upperBoundLocal) - calendarDay(startLocal)) / periodDays),
  );
  if (parts.has("COUNT")) {
    const count = Number(parts.get("COUNT"));
    if (!Number.isInteger(count) || count < 1 || count > 100_000) {
      throw new Error("AUTOMATION_RRULE_INVALID");
    }
    occurrence = Math.min(occurrence, count - 1);
  }
  let candidate =
    occurrence === 0
      ? startMs
      : localTimeToInstant(addCalendarDays(startLocal, occurrence * periodDays), schedule.timezone);
  while (candidate > upperBoundMs && occurrence > 0) {
    occurrence -= 1;
    candidate =
      occurrence === 0
        ? startMs
        : localTimeToInstant(
            addCalendarDays(startLocal, occurrence * periodDays),
            schedule.timezone,
          );
  }
  return candidate >= firstMs && candidate <= upperBoundMs
    ? new Date(candidate).toISOString()
    : null;
}

export class AutomationRepository {
  readonly #database: DatabaseSync;
  readonly #ownerProfileId: string;
  readonly #now: () => string;
  readonly #idFactory: () => string;

  constructor(databasePath: string, options: AutomationRepositoryOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#ownerProfileId = options.ownerProfileId ?? "local-default";
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    try {
      migrateDatabase(this.#database);
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  create(input: AutomationCreateInput): AutomationDefinition {
    const parsed = automationCreateInputSchema.parse(input);
    validateTimeZone(parsed.schedule.timezone);
    const now = this.#now();
    const id = this.#idFactory();
    const target = parsed.target ?? {
      conversationId: null,
      branchId: null,
      workspaceGrantIds: [],
    };
    validateAutomationTarget(parsed.kind, target);
    const execution = {
      modelRef: parsed.execution?.modelRef ?? "platform/auto",
      thinkingLevel: parsed.execution?.thinkingLevel ?? "medium",
      skillInstallationId: parsed.execution?.skillInstallationId ?? null,
      maxConcurrentRuns: 1 as const,
      catchUpPolicy: parsed.execution?.catchUpPolicy ?? ("skip" as const),
      retryPolicy: parsed.execution?.retryPolicy ?? ("none" as const),
    };
    const nextRunAt = nextAutomationRunAt(
      parsed.schedule,
      new Date(Date.parse(now) - 1).toISOString(),
    );
    this.#database
      .prepare(
        `INSERT INTO automation_definitions
         (id, owner_profile_id, name, prompt, kind, status, schedule_json, target_json,
          execution_json, next_run_at, last_run_at, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, ?, ?, 1)`,
      )
      .run(
        id,
        this.#ownerProfileId,
        parsed.name,
        parsed.prompt,
        parsed.kind,
        JSON.stringify(parsed.schedule),
        JSON.stringify(target),
        JSON.stringify(execution),
        nextRunAt,
        now,
        now,
      );
    return this.get(id);
  }

  update(raw: AutomationUpdateInput): AutomationDefinition {
    const input = automationUpdateInputSchema.parse(raw);
    const current = this.get(input.automationId);
    if (current.status === "deleted") throw new Error("AUTOMATION_NOT_FOUND");
    const now = this.#now();
    const kind = input.changes.kind ?? current.kind;
    const schedule = input.changes.schedule ?? current.schedule;
    const target = { ...current.target, ...input.changes.target };
    const execution = {
      ...current.execution,
      ...input.changes.execution,
      maxConcurrentRuns: 1 as const,
    };
    validateTimeZone(schedule.timezone);
    validateAutomationTarget(kind, target);
    const computedNextRunAt = nextAutomationRunAt(
      schedule,
      new Date(Date.parse(now) - 1).toISOString(),
    );
    const candidate = automationDefinitionSchema.parse({
      ...current,
      name: input.changes.name ?? current.name,
      prompt: input.changes.prompt ?? current.prompt,
      kind,
      schedule,
      target,
      execution,
      nextRunAt: current.status === "active" ? computedNextRunAt : null,
      updatedAt: now,
      revision: current.revision + 1,
    });
    const result = this.#database
      .prepare(
        `UPDATE automation_definitions
         SET name = ?, prompt = ?, kind = ?, schedule_json = ?, target_json = ?,
             execution_json = ?, next_run_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND owner_profile_id = ? AND revision = ? AND status <> 'deleted'`,
      )
      .run(
        candidate.name,
        candidate.prompt,
        candidate.kind,
        JSON.stringify(candidate.schedule),
        JSON.stringify(candidate.target),
        JSON.stringify(candidate.execution),
        candidate.nextRunAt,
        candidate.updatedAt,
        candidate.id,
        this.#ownerProfileId,
        input.revision,
      );
    if (Number(result.changes) !== 1) throw new Error("AUTOMATION_REVISION_CONFLICT");
    return this.get(candidate.id);
  }

  previewSchedule(raw: AutomationSchedulePreviewInput): AutomationSchedulePreview {
    const input = automationSchedulePreviewInputSchema.parse(raw);
    const after = input.after ?? new Date(Date.parse(this.#now()) - 1).toISOString();
    return {
      occurrences: previewAutomationRunTimes(input.schedule, after, input.count),
    };
  }

  get(id: string): AutomationDefinition {
    const row = this.#database
      .prepare("SELECT * FROM automation_definitions WHERE id = ? AND owner_profile_id = ?")
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("AUTOMATION_NOT_FOUND");
    return this.#definition(row);
  }

  list(includeDeleted = false): AutomationDefinition[] {
    return (
      this.#database
        .prepare(
          `SELECT * FROM automation_definitions
           WHERE owner_profile_id = ? AND (? = 1 OR status <> 'deleted')
           ORDER BY updated_at DESC, id`,
        )
        .all(this.#ownerProfileId, includeDeleted ? 1 : 0) as SqlRow[]
    ).map((row) => this.#definition(row));
  }

  setStatus(
    id: string,
    revision: number,
    status: "active" | "paused" | "deleted",
  ): AutomationDefinition {
    const now = this.#now();
    const current = this.get(id);
    const nextRunAt =
      status === "active"
        ? nextAutomationRunAt(current.schedule, new Date(Date.parse(now) - 1).toISOString())
        : null;
    const result = this.#database
      .prepare(
        `UPDATE automation_definitions
         SET status = ?, next_run_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND owner_profile_id = ? AND revision = ? AND status <> 'deleted'`,
      )
      .run(status, nextRunAt, now, id, this.#ownerProfileId, revision);
    if (Number(result.changes) !== 1) throw new Error("AUTOMATION_REVISION_CONFLICT");
    return this.get(id);
  }

  enqueueDue(options: AutomationDueOptions = {}): AutomationRun[] {
    const now = options.now ?? this.#now();
    const nowMs = Date.parse(now);
    if (Number.isNaN(nowMs)) throw new Error("AUTOMATION_TIME_INVALID");
    const due = this.#database
      .prepare(
        `SELECT * FROM automation_definitions
         WHERE owner_profile_id = ? AND status = 'active' AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at, id`,
      )
      .all(this.#ownerProfileId, now) as SqlRow[];
    const runs: AutomationRun[] = [];
    for (const row of due) {
      const definition = this.#definition(row);
      const scheduledFor = definition.nextRunAt;
      if (!scheduledFor) continue;
      const scheduledForMs = Date.parse(scheduledFor);
      const missed =
        scheduledForMs < nowMs &&
        (options.forceMissed === true || nowMs - scheduledForMs > 5 * 60_000);
      const reconciledScheduledFor =
        missed && definition.execution.catchUpPolicy === "latest_once"
          ? (latestAutomationRunAt(definition.schedule, scheduledFor, now) ?? scheduledFor)
          : scheduledFor;
      const active = this.#database
        .prepare(
          `SELECT 1 FROM automation_runs WHERE automation_id = ? AND status IN (${activeRunStatuses
            .map(() => "?")
            .join(", ")}) LIMIT 1`,
        )
        .get(definition.id, ...activeRunStatuses);
      const run = this.#insertRun(
        definition,
        reconciledScheduledFor,
        missed && definition.execution.catchUpPolicy === "latest_once" ? "catch_up" : "schedule",
        "schedule",
        active
          ? "skipped_overlap"
          : missed && definition.execution.catchUpPolicy === "skip"
            ? "missed"
            : "scheduled",
      );
      const next = nextAutomationRunAt(definition.schedule, now);
      this.#database
        .prepare(
          `UPDATE automation_definitions
           SET next_run_at = ?, last_run_at = ?, updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        )
        .run(next, reconciledScheduledFor, now, definition.id);
      runs.push(run);
    }
    return runs;
  }

  runNow(id: string): AutomationRun {
    const definition = this.get(id);
    if (definition.status === "deleted") throw new Error("AUTOMATION_NOT_FOUND");
    const now = this.#now();
    const active = this.#database
      .prepare(
        `SELECT 1 FROM automation_runs WHERE automation_id = ? AND status IN (${activeRunStatuses
          .map(() => "?")
          .join(", ")}) LIMIT 1`,
      )
      .get(definition.id, ...activeRunStatuses);
    return this.#insertRun(
      definition,
      now,
      "manual",
      this.#idFactory(),
      active ? "skipped_overlap" : "scheduled",
    );
  }

  claimNext(hostId: string, leaseMs = 60_000): AutomationRun | null {
    if (!hostId.trim()) throw new Error("AUTOMATION_HOST_REQUIRED");
    const now = this.#now();
    const row = this.#database
      .prepare(
        `SELECT * FROM automation_runs
         WHERE status = 'scheduled'
            OR (status IN ('claimed', 'retry_scheduled') AND lease_expires_at <= ?)
         ORDER BY scheduled_for, created_at, id LIMIT 1`,
      )
      .get(now) as SqlRow | undefined;
    if (!row) return null;
    const leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
    const result = this.#database
      .prepare(
        `UPDATE automation_runs
         SET status = 'claimed', claimed_by_host_id = ?, lease_expires_at = ?,
             attempt = attempt + CASE WHEN status IN ('claimed', 'retry_scheduled') THEN 1 ELSE 0 END
         WHERE id = ? AND (
           status = 'scheduled'
           OR (status IN ('claimed', 'retry_scheduled') AND lease_expires_at <= ?)
         )`,
      )
      .run(hostId, leaseExpiresAt, String(row.id), now);
    return Number(result.changes) === 1 ? this.getRun(String(row.id)) : null;
  }

  markStarted(
    runId: string,
    options: {
      conversationId?: string;
      assistantMessageId?: string;
      generationId?: string;
    } = {},
  ): AutomationRun {
    return this.#transition(runId, ["claimed"], "running", {
      startedAt: this.#now(),
      leaseExpiresAt: null,
      conversationId: options.conversationId,
      assistantMessageId: options.assistantMessageId,
      generationId: options.generationId,
    });
  }

  markRetryScheduled(runId: string, delayMs: number, failureCode: string): AutomationRun {
    if (!Number.isFinite(delayMs) || delayMs < 1_000) {
      throw new Error("AUTOMATION_RETRY_DELAY_INVALID");
    }
    const retryAt = new Date(Date.parse(this.#now()) + delayMs).toISOString();
    return this.#transition(runId, ["claimed"], "retry_scheduled", {
      leaseExpiresAt: retryAt,
      failureCode,
    });
  }

  markFinished(
    runId: string,
    status: "succeeded" | "failed" | "cancelled" | "needs_attention" | "interrupted",
    options: { failureCode?: string; conversationId?: string; generationId?: string } = {},
  ): AutomationRun {
    return this.#transition(runId, ["claimed", "starting", "running"], status, {
      finishedAt: this.#now(),
      leaseExpiresAt: null,
      failureCode: options.failureCode ?? null,
      conversationId: options.conversationId,
      generationId: options.generationId,
      actionRequired: status === "needs_attention",
    });
  }

  getRun(id: string): AutomationRun {
    const row = this.#database.prepare("SELECT * FROM automation_runs WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("AUTOMATION_RUN_NOT_FOUND");
    const definition = this.get(String(row.automation_id));
    if (definition.ownerProfileId !== this.#ownerProfileId)
      throw new Error("AUTOMATION_RUN_NOT_FOUND");
    return this.#run(row);
  }

  listRuns(automationId: string, limit = 50): AutomationRun[] {
    this.get(automationId);
    return (
      this.#database
        .prepare(
          `SELECT * FROM automation_runs WHERE automation_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(automationId, Math.max(1, Math.min(200, limit))) as SqlRow[]
    ).map((row) => this.#run(row));
  }

  activeRunForAssistantMessage(assistantMessageId: string): AutomationRun | null {
    const row = this.#database
      .prepare(
        `SELECT ar.* FROM automation_runs ar
         JOIN automation_definitions ad ON ad.id = ar.automation_id
         WHERE ar.assistant_message_id = ? AND ad.owner_profile_id = ?
           AND ar.status IN ('starting', 'running', 'claimed')`,
      )
      .get(assistantMessageId, this.#ownerProfileId) as SqlRow | undefined;
    return row ? this.#run(row) : null;
  }

  #insertRun(
    definition: AutomationDefinition,
    scheduledFor: string,
    trigger: AutomationRun["trigger"],
    attemptGroup: string,
    status: AutomationRunStatus,
  ): AutomationRun {
    const id = this.#idFactory();
    const now = this.#now();
    this.#database
      .prepare(
        `INSERT INTO automation_runs
         (id, automation_id, scheduled_for, attempt_group, trigger, status, conversation_id,
          branch_id, generation_id, execution_run_id, attempt, claimed_by_host_id,
          lease_expires_at, prompt_snapshot, config_snapshot_json, failure_code, action_required,
          created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, NULL, NULL, ?, ?, NULL, 0, ?, NULL, ?)
         ON CONFLICT(automation_id, scheduled_for, attempt_group) DO NOTHING`,
      )
      .run(
        id,
        definition.id,
        scheduledFor,
        attemptGroup,
        trigger,
        status,
        definition.target.conversationId,
        definition.target.branchId,
        definition.prompt,
        JSON.stringify({ execution: definition.execution, target: definition.target }),
        now,
        status === "skipped_overlap" || status === "missed" ? now : null,
      );
    const row = this.#database
      .prepare(
        `SELECT * FROM automation_runs
         WHERE automation_id = ? AND scheduled_for = ? AND attempt_group = ?`,
      )
      .get(definition.id, scheduledFor, attemptGroup) as SqlRow;
    return this.#run(row);
  }

  #transition(
    runId: string,
    from: AutomationRunStatus[],
    to: AutomationRunStatus,
    values: {
      startedAt?: string;
      finishedAt?: string;
      leaseExpiresAt?: string | null;
      failureCode?: string | null;
      conversationId?: string;
      generationId?: string;
      assistantMessageId?: string;
      actionRequired?: boolean;
    },
  ): AutomationRun {
    const placeholders = from.map(() => "?").join(", ");
    const result = this.#database
      .prepare(
        `UPDATE automation_runs SET status = ?, started_at = COALESCE(?, started_at),
          finished_at = COALESCE(?, finished_at), lease_expires_at = ?,
          failure_code = ?, conversation_id = COALESCE(?, conversation_id),
          assistant_message_id = COALESCE(?, assistant_message_id),
          generation_id = COALESCE(?, generation_id), action_required = ?
         WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(
        to,
        values.startedAt ?? null,
        values.finishedAt ?? null,
        values.leaseExpiresAt ?? null,
        values.failureCode ?? null,
        values.conversationId ?? null,
        values.assistantMessageId ?? null,
        values.generationId ?? null,
        values.actionRequired ? 1 : 0,
        runId,
        ...from,
      );
    if (Number(result.changes) !== 1) throw new Error("AUTOMATION_RUN_STATE_CONFLICT");
    return this.getRun(runId);
  }

  #definition(row: SqlRow): AutomationDefinition {
    return automationDefinitionSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      name: row.name,
      prompt: row.prompt,
      kind: row.kind,
      status: row.status,
      schedule: JSON.parse(String(row.schedule_json)),
      target: JSON.parse(String(row.target_json)),
      execution: JSON.parse(String(row.execution_json)),
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: Number(row.revision),
    });
  }

  #run(row: SqlRow): AutomationRun {
    return automationRunSchema.parse({
      id: row.id,
      automationId: row.automation_id,
      scheduledFor: row.scheduled_for,
      trigger: row.trigger,
      status: row.status,
      conversationId: row.conversation_id,
      branchId: row.branch_id,
      assistantMessageId: row.assistant_message_id,
      generationId: row.generation_id,
      executionRunId: row.execution_run_id,
      attempt: Number(row.attempt),
      claimedByHostId: row.claimed_by_host_id,
      leaseExpiresAt: row.lease_expires_at,
      promptSnapshot: row.prompt_snapshot,
      configSnapshot: JSON.parse(String(row.config_snapshot_json)),
      failureCode: row.failure_code,
      actionRequired: Number(row.action_required) === 1,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    });
  }
}
