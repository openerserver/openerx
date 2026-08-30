import type {
  AutomationCommandEnvelope,
  AutomationDefinition,
  AutomationRun,
  AutomationSchedulePreview,
} from "@openerx/contracts";
import type { AutomationRepository } from "@openerx/storage";

export class AutomationAppService {
  readonly #repository: AutomationRepository;
  readonly #wakeScheduler: () => Promise<unknown>;

  constructor(repository: AutomationRepository, wakeScheduler: () => Promise<unknown>) {
    this.#repository = repository;
    this.#wakeScheduler = wakeScheduler;
  }

  async handle(
    request: AutomationCommandEnvelope,
  ): Promise<
    | AutomationDefinition
    | AutomationDefinition[]
    | AutomationRun
    | AutomationRun[]
    | AutomationSchedulePreview
  > {
    switch (request.command) {
      case "automation.create": {
        const result = this.#repository.create(request.input);
        void this.#wakeScheduler();
        return result;
      }
      case "automation.list":
        return this.#repository.list(request.input.includeDeleted ?? false);
      case "automation.get":
        return this.#repository.get(request.input.automationId);
      case "automation.update": {
        const result = this.#repository.update(request.input);
        void this.#wakeScheduler();
        return result;
      }
      case "automation.pause":
        return this.#repository.setStatus(
          request.input.automationId,
          request.input.revision,
          "paused",
        );
      case "automation.resume": {
        const result = this.#repository.setStatus(
          request.input.automationId,
          request.input.revision,
          "active",
        );
        void this.#wakeScheduler();
        return result;
      }
      case "automation.delete":
        return this.#repository.setStatus(
          request.input.automationId,
          request.input.revision,
          "deleted",
        );
      case "automation.runNow": {
        const result = this.#repository.runNow(request.input.automationId);
        void this.#wakeScheduler();
        return result;
      }
      case "automation.runs.list":
        return this.#repository.listRuns(request.input.automationId, request.input.limit);
      case "automation.schedule.preview":
        return this.#repository.previewSchedule(request.input);
    }
  }
}
