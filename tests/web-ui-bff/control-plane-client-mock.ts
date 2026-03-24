import { mock } from "bun:test";
import type * as ControlPlaneClientModule from "../../control-plane/web-ui-bff/src/lib/control-plane-client";

type ControlPlaneClientModuleShape = typeof ControlPlaneClientModule;

type AuthHeaderContext = {
  req: {
    header: (name: string) => string | undefined;
  };
};

export function createControlPlaneClientModuleMock(
  overrides: Partial<ControlPlaneClientModuleShape> = {},
): ControlPlaneClientModuleShape {
  return {
    authHeader: mock((c: AuthHeaderContext) => c.req.header("Authorization") || ""),
    cpFetch: mock(async () => ({ ok: true, status: 200, data: {} })),
    createInternalAuthorization: mock(async () => "Bearer internal"),
    setControlPlaneFetchHandler: mock(() => undefined),
    ...overrides,
  } as ControlPlaneClientModuleShape;
}
