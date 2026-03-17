import { resolveDatabaseDialect } from "./config";
import * as pgSchema from "./schema.pg";
import * as sqliteSchema from "./schema.sqlite";

export type {
  ApprovalPolicyMode,
  CredentialType,
  EnvironmentApprovalPolicyBinding,
  PaidExecutionLeaseStatus,
  ProjectSettings,
  RuntimeUsageBaselineMatchScope,
  RuntimeUsageLedgerStatus,
  RuntimeUsageLedgerStepStatus,
  RuntimeUsageLedgerStepType,
} from "./schema.sqlite";

const runtimeSchema: typeof sqliteSchema =
  resolveDatabaseDialect() === "postgres"
    ? (pgSchema as unknown as typeof sqliteSchema)
    : sqliteSchema;

export const organizations = runtimeSchema.organizations;
export const projects = runtimeSchema.projects;
export const environments = runtimeSchema.environments;
export const users = runtimeSchema.users;
export const projectRoles = runtimeSchema.projectRoles;
export const paidExecutionLeases = runtimeSchema.paidExecutionLeases;
export const runtimeUsageLedgers = runtimeSchema.runtimeUsageLedgers;
export const runtimeUsageLedgerSteps = runtimeSchema.runtimeUsageLedgerSteps;
export const runtimeUsageBaselines = runtimeSchema.runtimeUsageBaselines;
export const sessions = runtimeSchema.sessions;
export const taskSessions = runtimeSchema.taskSessions;
export const repositories = runtimeSchema.repositories;
export const repositoryCredentials = runtimeSchema.repositoryCredentials;
export const tasks = runtimeSchema.tasks;
export const policyTemplates = runtimeSchema.policyTemplates;
export const auditEvents = runtimeSchema.auditEvents;
export const costRecords = runtimeSchema.costRecords;
export const approvalTickets = runtimeSchema.approvalTickets;
export const taskNodes = runtimeSchema.taskNodes;
export const taskEdges = runtimeSchema.taskEdges;
export const projectTaskRelations = runtimeSchema.projectTaskRelations;
export const agentRuns = runtimeSchema.agentRuns;
export const codeChanges = runtimeSchema.codeChanges;
export const fileChanges = runtimeSchema.fileChanges;
export const plugins = runtimeSchema.plugins;
export const budgetConfigs = runtimeSchema.budgetConfigs;
export const workbenchLayouts = runtimeSchema.workbenchLayouts;
export const roleAgents = runtimeSchema.roleAgents;
export const roleAgentBindings = runtimeSchema.roleAgentBindings;
export const roleAgentProjectOverrides = runtimeSchema.roleAgentProjectOverrides;
export const workflowTemplates = runtimeSchema.workflowTemplates;
export const workflowTemplateStages = runtimeSchema.workflowTemplateStages;
export const taskWorkflowRuns = runtimeSchema.taskWorkflowRuns;
export const taskStageRuns = runtimeSchema.taskStageRuns;
export const roleAggregateConclusions = runtimeSchema.roleAggregateConclusions;
export const developerChangeRequests = runtimeSchema.developerChangeRequests;
export const taskOperatingModes = runtimeSchema.taskOperatingModes;
export const bossDecisions = runtimeSchema.bossDecisions;
export const humanEscalations = runtimeSchema.humanEscalations;
