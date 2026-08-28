import { z } from "zod";
import { entityIdSchema } from "./common";

export const BROKERED_BASH_CONTRACT_VERSION = "brokered_bash_v1" as const;
export const BROKERED_BASH_V1_FEATURE_FLAG = "OPENERX_BROKERED_BASH_V1" as const;
export const BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID = "environment-core-v1" as const;
export const BROKERED_BASH_DENY_NETWORK_POLICY_ID = "network-deny-v1" as const;
export const BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION = "pbash-fake-v1" as const;
export const BROKERED_BASH_MAX_COMMAND_BYTES = 65_536;
export const BROKERED_BASH_DEFAULT_TIMEOUT_MS = 120_000;
export const BROKERED_BASH_MAX_TIMEOUT_MS = 1_800_000;

export function brokeredBashV1Enabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized === "1" || normalized === "true";
}

export const brokeredBashExecutionProfileSchema = z.enum(["read_only", "workspace_write"]);
export const brokeredBashPolicyIdSchema = z.string().regex(/^[a-z][a-z0-9._-]{2,119}$/u);
export const brokeredBashErrorCodeSchema = z.enum([
  "BROKERED_BASH_ACTIVE_WORKSPACE_REQUIRED",
  "BROKERED_BASH_ADDITIONAL_WORKSPACE_INVALID",
  "BROKERED_BASH_EXECUTION_CONTEXT_MISMATCH",
  "BROKERED_BASH_EXECUTION_CONTEXT_REQUIRED",
  "BROKERED_BASH_EXECUTION_PROFILE_MISMATCH",
  "BROKERED_BASH_FAKE_RUNNER_ONLY",
  "BROKERED_BASH_POLICY_MISMATCH",
  "BROKERED_BASH_RUNNER_UNAVAILABLE",
  "BROKERED_BASH_WORKSPACE_GRANT_INVALID",
]);

const additionalExecutionGrantIdsSchema = z
  .array(entityIdSchema)
  .max(99)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Additional execution grants must be unique",
  });

const executionContextShape = {
  contractVersion: z.literal(BROKERED_BASH_CONTRACT_VERSION),
  activeExecutionGrantId: entityIdSchema,
  additionalExecutionGrantIds: additionalExecutionGrantIdsSchema,
  executionProfile: brokeredBashExecutionProfileSchema,
  environmentPolicyId: brokeredBashPolicyIdSchema,
  networkPolicyId: brokeredBashPolicyIdSchema,
  sandboxPolicyVersion: brokeredBashPolicyIdSchema,
};

function rejectActiveGrantDuplication(
  value: { activeExecutionGrantId: string; additionalExecutionGrantIds: string[] },
  context: z.RefinementCtx,
): void {
  if (value.additionalExecutionGrantIds.includes(value.activeExecutionGrantId)) {
    context.addIssue({
      code: "custom",
      message: "Active execution grant cannot also be an additional grant",
      path: ["additionalExecutionGrantIds"],
    });
  }
}

export const brokeredBashExecutionContextSchema = z
  .object(executionContextShape)
  .strict()
  .superRefine(rejectActiveGrantDuplication);

export const brokeredBashOperationSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(240),
    operation: z.literal("shell_command_execute"),
    ...executionContextShape,
    shell: z.literal("bash"),
    command: z
      .string()
      .min(1)
      .max(BROKERED_BASH_MAX_COMMAND_BYTES)
      .refine(
        (value) => new TextEncoder().encode(value).byteLength <= BROKERED_BASH_MAX_COMMAND_BYTES,
        { message: "Bash command exceeds the UTF-8 byte limit" },
      )
      .refine((value) => !value.includes("\0"), { message: "Bash command cannot contain NUL" }),
    timeoutMs: z.number().int().min(1_000).max(BROKERED_BASH_MAX_TIMEOUT_MS),
  })
  .strict()
  .superRefine(rejectActiveGrantDuplication);

export type BrokeredBashExecutionContext = z.infer<typeof brokeredBashExecutionContextSchema>;
export type BrokeredBashExecutionProfile = z.infer<typeof brokeredBashExecutionProfileSchema>;
export type BrokeredBashOperation = z.infer<typeof brokeredBashOperationSchema>;
export type BrokeredBashErrorCode = z.infer<typeof brokeredBashErrorCodeSchema>;
