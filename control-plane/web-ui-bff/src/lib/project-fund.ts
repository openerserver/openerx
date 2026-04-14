import { type UpstreamResponse, cpFetch } from "./control-plane-client";

export interface ProjectModelFundSnapshot {
  id: string | null;
  projectId: string;
  currency: string;
  totalGranted: number;
  reserved: number;
  consumed: number;
  available: number;
  status: "active" | "depleted";
  createdAt: string | null;
  updatedAt: string | null;
  hasFund: boolean;
}

export interface ProjectModelFundLedgerEntry {
  id: string;
  projectId: string;
  fundId: string;
  type: "grant" | "reserve" | "consume" | "refund" | "adjust";
  amountUsd: number;
  balanceAfter: number;
  modelRoute?: string | null;
  taskId?: string | null;
  runtimeSessionId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  note?: string | null;
}

export interface ProjectModelFundMutationResponse {
  fund: ProjectModelFundSnapshot;
  ledgerEntry: ProjectModelFundLedgerEntry;
}

export interface ProjectModelFundExecutionMutationInput {
  amountUsd: number;
  modelRoute?: string | null;
  taskId?: string | null;
  runtimeSessionId?: string | null;
  note?: string | null;
}

function roundUsd(value: number) {
  return Number(Number(value || 0).toFixed(4));
}

function encodeProjectId(projectId: string) {
  return encodeURIComponent(projectId);
}

export async function fetchProjectFundSnapshot(
  projectId: string,
  authorization: string,
): Promise<UpstreamResponse<ProjectModelFundSnapshot>> {
  return cpFetch<ProjectModelFundSnapshot>(`/api/projects/${encodeProjectId(projectId)}/fund`, {
    authorization,
  });
}

async function mutateProjectFund(
  projectId: string,
  action: "reserve" | "consume" | "refund",
  authorization: string,
  input: ProjectModelFundExecutionMutationInput,
): Promise<UpstreamResponse<ProjectModelFundMutationResponse>> {
  return cpFetch<ProjectModelFundMutationResponse>(
    `/api/projects/${encodeProjectId(projectId)}/fund/${action}`,
    {
      method: "POST",
      authorization,
      body: {
        amountUsd: roundUsd(input.amountUsd),
        modelRoute: input.modelRoute ?? undefined,
        taskId: input.taskId ?? undefined,
        runtimeSessionId: input.runtimeSessionId ?? undefined,
        note: input.note ?? undefined,
      },
    },
  );
}

export async function reserveProjectFund(
  projectId: string,
  authorization: string,
  input: ProjectModelFundExecutionMutationInput,
) {
  return mutateProjectFund(projectId, "reserve", authorization, input);
}

export async function consumeProjectFund(
  projectId: string,
  authorization: string,
  input: ProjectModelFundExecutionMutationInput,
) {
  return mutateProjectFund(projectId, "consume", authorization, input);
}

export async function refundProjectFund(
  projectId: string,
  authorization: string,
  input: ProjectModelFundExecutionMutationInput,
) {
  return mutateProjectFund(projectId, "refund", authorization, input);
}