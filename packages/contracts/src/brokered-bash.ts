import { z } from "zod";
import { entityIdSchema } from "./common";

export const BROKERED_BASH_CONTRACT_VERSION = "brokered_bash_v1" as const;
export const BROKERED_BASH_V1_FEATURE_FLAG = "OPENERX_BROKERED_BASH_V1" as const;
export const BROKERED_BASH_RUNNER_MODE_ENV = "OPENERX_BROKERED_BASH_RUNNER" as const;
export const BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID = "environment-core-v1" as const;
export const BROKERED_BASH_NONE_ENVIRONMENT_POLICY_ID = "environment-none-v1" as const;
export const BROKERED_BASH_ALL_ENVIRONMENT_POLICY_ID = "environment-all-v1" as const;
export const BROKERED_BASH_DENY_NETWORK_POLICY_ID = "network-deny-v1" as const;
export const BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID =
  "network-controlled-egress-v1" as const;
export const BROKERED_BASH_FAKE_SANDBOX_POLICY_VERSION = "pbash-fake-v1" as const;
export const BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION = "macos-seatbelt-v1" as const;
export const BROKERED_BASH_MAX_COMMAND_BYTES = 65_536;
export const BROKERED_BASH_DEFAULT_TIMEOUT_MS = 120_000;
export const BROKERED_BASH_MAX_TIMEOUT_MS = 1_800_000;

export function brokeredBashV1Enabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized === "1" || normalized === "true";
}

export const brokeredBashRunnerModeSchema = z.enum(["fake", "macos"]);

export function brokeredBashRunnerMode(
  value: string | undefined,
): z.infer<typeof brokeredBashRunnerModeSchema> | null {
  if (value === undefined || value.trim() === "") return "fake";
  const parsed = brokeredBashRunnerModeSchema.safeParse(value.trim().toLocaleLowerCase());
  return parsed.success ? parsed.data : null;
}

export const brokeredBashExecutionProfileSchema = z.enum(["read_only", "workspace_write"]);
export const brokeredBashExecutionOriginSchema = z.enum([
  "local_interactive",
  "remote_attended",
  "remote_unattended",
]);
export const brokeredBashWorkspaceWriteModeSchema = z.enum([
  "none",
  "direct_workspace",
  "isolated_change_set",
]);
export const brokeredBashPolicyIdSchema = z.string().regex(/^[a-z][a-z0-9._-]{2,119}$/u);
export const brokeredBashErrorCodeSchema = z.enum([
  "BROKERED_BASH_ACTIVE_WORKSPACE_REQUIRED",
  "BROKERED_BASH_ADDITIONAL_WORKSPACE_INVALID",
  "BROKERED_BASH_BASH_MISSING",
  "BROKERED_BASH_BROAD_WORKSPACE_DENIED",
  "BROKERED_BASH_CANCELLED",
  "BROKERED_BASH_CAPABILITY_PROBE_FAILED",
  "BROKERED_BASH_CHANGE_EVIDENCE_FAILED",
  "BROKERED_BASH_COMMAND_FAILED",
  "BROKERED_BASH_DESTRUCTION_UNCERTAIN",
  "BROKERED_BASH_EXECUTION_CONTEXT_MISMATCH",
  "BROKERED_BASH_EXECUTION_CONTEXT_REQUIRED",
  "BROKERED_BASH_EXECUTION_PROFILE_MISMATCH",
  "BROKERED_BASH_ENVIRONMENT_ALL_DENIED",
  "BROKERED_BASH_ENVIRONMENT_POLICY_INVALID",
  "BROKERED_BASH_ENVIRONMENT_SECRET_BLOCKED",
  "BROKERED_BASH_EGRESS_ADDRESS_DENIED",
  "BROKERED_BASH_EGRESS_CREDENTIALS_DENIED",
  "BROKERED_BASH_EGRESS_DOMAIN_DENIED",
  "BROKERED_BASH_EGRESS_POLICY_INVALID",
  "BROKERED_BASH_EGRESS_PORT_DENIED",
  "BROKERED_BASH_EGRESS_PROTOCOL_DENIED",
  "BROKERED_BASH_EGRESS_REQUEST_INVALID",
  "BROKERED_BASH_EGRESS_TLS_INVALID",
  "BROKERED_BASH_EGRESS_TLS_REQUIRED",
  "BROKERED_BASH_EGRESS_TLS_SNI_DENIED",
  "BROKERED_BASH_EGRESS_TLS_SNI_REQUIRED",
  "BROKERED_BASH_FAKE_RUNNER_ONLY",
  "BROKERED_BASH_HARDLINK_BOUNDARY_UNSAFE",
  "BROKERED_BASH_ISOLATED_CHANGE_SET_UNAVAILABLE",
  "BROKERED_BASH_WORKING_COPY_FAILED",
  "BROKERED_BASH_PLATFORM_UNSUPPORTED",
  "BROKERED_BASH_POLICY_MISMATCH",
  "BROKERED_BASH_PROTECTED_WORKSPACE_DENIED",
  "BROKERED_BASH_PROCESS_LIMIT_PROBE_FAILED",
  "BROKERED_BASH_PROCESS_LIMIT_UNAVAILABLE",
  "BROKERED_BASH_RESOURCE_LIMIT_INVALID",
  "BROKERED_BASH_RUNNER_MODE_INVALID",
  "BROKERED_BASH_RUNNER_START_FAILED",
  "BROKERED_BASH_RUNNER_UNAVAILABLE",
  "BROKERED_BASH_SANDBOX_EXEC_MISSING",
  "BROKERED_BASH_SANDBOX_PATH_INVALID",
  "BROKERED_BASH_SANDBOX_PROFILE_TOO_LARGE",
  "BROKERED_BASH_TIMEOUT",
  "BROKERED_BASH_TOOL_CALL_ALREADY_RUNNING",
  "BROKERED_BASH_WORKSPACE_GRANT_INVALID",
  "BROKERED_BASH_WORKSPACE_PREFLIGHT_FAILED",
  "BROKERED_BASH_WORKSPACE_PREFLIGHT_LIMIT",
  "BROKERED_BASH_WORKSPACE_ROOT_INVALID",
  "BROKERED_BASH_WORKSPACE_ROOT_OVERLAP",
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
  executionOrigin: brokeredBashExecutionOriginSchema,
  workspaceWriteMode: brokeredBashWorkspaceWriteModeSchema,
  environmentPolicyId: brokeredBashPolicyIdSchema,
  environmentPolicyDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .optional(),
  networkPolicyId: brokeredBashPolicyIdSchema,
  networkPolicyDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .optional(),
  sandboxPolicyVersion: brokeredBashPolicyIdSchema,
};

function rejectActiveGrantDuplication(
  value: {
    activeExecutionGrantId: string;
    additionalExecutionGrantIds: string[];
    executionProfile: z.infer<typeof brokeredBashExecutionProfileSchema>;
    executionOrigin: z.infer<typeof brokeredBashExecutionOriginSchema>;
    workspaceWriteMode: z.infer<typeof brokeredBashWorkspaceWriteModeSchema>;
    environmentPolicyId: string;
    networkPolicyId: string;
  },
  context: z.RefinementCtx,
): void {
  if (value.additionalExecutionGrantIds.includes(value.activeExecutionGrantId)) {
    context.addIssue({
      code: "custom",
      message: "Active execution grant cannot also be an additional grant",
      path: ["additionalExecutionGrantIds"],
    });
  }
  if (value.executionProfile === "read_only" && value.workspaceWriteMode !== "none") {
    context.addIssue({
      code: "custom",
      message: "read_only execution requires workspaceWriteMode=none",
      path: ["workspaceWriteMode"],
    });
  }
  if (value.executionProfile === "workspace_write" && value.workspaceWriteMode === "none") {
    context.addIssue({
      code: "custom",
      message: "workspace_write execution requires an explicit write mode",
      path: ["workspaceWriteMode"],
    });
  }
  if (
    value.executionOrigin === "remote_unattended" &&
    value.executionProfile === "workspace_write" &&
    value.workspaceWriteMode !== "isolated_change_set"
  ) {
    context.addIssue({
      code: "custom",
      message: "remote_unattended workspace writes require isolated_change_set",
      path: ["workspaceWriteMode"],
    });
  }
  if (
    value.executionOrigin !== "local_interactive" &&
    (value.environmentPolicyId !== BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID ||
      value.networkPolicyId !== BROKERED_BASH_DENY_NETWORK_POLICY_ID)
  ) {
    context.addIssue({
      code: "custom",
      message: "Remote Bash requires the core environment and denied network",
      path: ["executionOrigin"],
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
      .refine((value) => !value.includes("\0"), {
        message: "Bash command cannot contain NUL",
      }),
    timeoutMs: z.number().int().min(1_000).max(BROKERED_BASH_MAX_TIMEOUT_MS),
  })
  .strict()
  .superRefine(rejectActiveGrantDuplication);

export type BrokeredBashExecutionContext = z.infer<typeof brokeredBashExecutionContextSchema>;
export type BrokeredBashExecutionProfile = z.infer<typeof brokeredBashExecutionProfileSchema>;
export type BrokeredBashExecutionOrigin = z.infer<typeof brokeredBashExecutionOriginSchema>;
export type BrokeredBashWorkspaceWriteMode = z.infer<typeof brokeredBashWorkspaceWriteModeSchema>;
export type BrokeredBashRunnerMode = z.infer<typeof brokeredBashRunnerModeSchema>;
export type BrokeredBashOperation = z.infer<typeof brokeredBashOperationSchema>;
export type BrokeredBashErrorCode = z.infer<typeof brokeredBashErrorCodeSchema>;
