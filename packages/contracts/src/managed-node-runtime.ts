import { z } from "zod";

// Only Main creates this descriptor after verifying the pinned distribution.
// It is bootstrap data, never part of a renderer/model-controlled tool operation.
export const managedNodeRuntimeSchema = z
  .object({
    nodeVersion: z.string().regex(/^24\.\d+\.\d+$/),
    npmVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    platform: z.enum(["win32", "darwin", "linux"]),
    architecture: z.enum(["x64", "arm64"]),
    rootDirectory: z.string().min(1),
    nodeExecutable: z.string().min(1),
    npmCli: z.string().min(1),
    npxCli: z.string().min(1),
    binDirectory: z.string().min(1),
    manifestPath: z.string().min(1),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ManagedNodeRuntime = z.infer<typeof managedNodeRuntimeSchema>;
export const managedNodeRuntimeErrorSchema = z.enum([
  "MANAGED_NODE_RUNTIME_MISSING",
  "MANAGED_NODE_RUNTIME_INTEGRITY_FAILED",
  "MANAGED_NODE_RUNTIME_TARGET_UNSUPPORTED",
]);
export type ManagedNodeRuntimeError = z.infer<typeof managedNodeRuntimeErrorSchema>;
export interface ManagedNodeRuntimeState {
  nodeRuntime?: ManagedNodeRuntime;
  nodeRuntimeError?: ManagedNodeRuntimeError;
}
