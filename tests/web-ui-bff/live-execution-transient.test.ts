import { describe, expect, test } from "bun:test";
import {
  TransientUpstreamExecutionError,
  buildTaskFailureError,
  runWithTransientUpstreamRetry,
} from "./live-execution-transient";

describe("live execution transient helper", () => {
  test("classifies high-demand task failures as transient upstream errors", () => {
    const error = buildTaskFailureError(
      "task-1",
      "Task failed while waiting for hook state",
      '{"error":{"message":"high demand","code":503,"status":"Service Unavailable"}}',
    );

    expect(error).toBeInstanceOf(TransientUpstreamExecutionError);
    expect(error.message).toContain("task-1");
  });

  test("retries transient upstream failures and eventually succeeds", async () => {
    let attempts = 0;

    const completed = await runWithTransientUpstreamRetry({
      label: "test retry",
      scope: "live-execution-transient.test",
      async fn() {
        attempts += 1;
        if (attempts < 2) {
          throw buildTaskFailureError(
            "task-2",
            "Task failed before post-execution hooks completed",
            '{"error":{"message":"This model is currently experiencing high demand.","code":503,"status":"Service Unavailable"}}',
          );
        }
      },
    });

    expect(completed).toBe(true);
    expect(attempts).toBe(2);
  });

  test("does not swallow non-transient failures", async () => {
    let thrown: unknown;

    try {
      await runWithTransientUpstreamRetry({
        label: "test hard failure",
        scope: "live-execution-transient.test",
        async fn() {
          throw new Error("permanent failure");
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("permanent failure");
  });
});