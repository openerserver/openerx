export function buildTaskRouteRegistrationsFromBuilders<
  TShared,
  TCore,
  TAgentRunWrites,
  TSessions,
  TProjections,
>(builders: {
  buildShared: () => TShared;
  buildCore: (shared: TShared) => TCore;
  buildAgentRunWrites: (shared: TShared) => TAgentRunWrites;
  buildSessions: (shared: TShared) => TSessions;
  buildProjections: (shared: TShared) => TProjections;
}) {
  const shared = builders.buildShared();

  return {
    agentRunCompat: builders.buildAgentRunWrites(shared),
    core: builders.buildCore(shared),
    sessions: builders.buildSessions(shared),
    projections: builders.buildProjections(shared),
  };
}

export function registerTaskRouteModulesFromRegistrars<
  TRoutes,
  TRegistrations extends {
    agentRunCompat: unknown;
    core: unknown;
    sessions: unknown;
    projections: unknown;
  },
>(taskRoutes: TRoutes, registrars: {
  buildRegistrations: () => TRegistrations;
  registerAgentRunReads: (routes: TRoutes) => unknown;
  registerAgentRunWrites: (routes: TRoutes, deps: TRegistrations["agentRunCompat"]) => unknown;
  registerCore: (routes: TRoutes, deps: TRegistrations["core"]) => unknown;
  registerSessions: (routes: TRoutes, deps: TRegistrations["sessions"]) => unknown;
  registerProjections: (routes: TRoutes, deps: TRegistrations["projections"]) => unknown;
}) {
  const registrations = registrars.buildRegistrations();

  registrars.registerAgentRunReads(taskRoutes);
  registrars.registerAgentRunWrites(taskRoutes, registrations.agentRunCompat);
  registrars.registerCore(taskRoutes, registrations.core);
  registrars.registerSessions(taskRoutes, registrations.sessions);
  registrars.registerProjections(taskRoutes, registrations.projections);
}
