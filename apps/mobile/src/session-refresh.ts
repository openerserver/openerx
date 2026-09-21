import type { MobileSession } from "./session";

export function maintainMobileSession(
  initial: MobileSession,
  refresh: (session: MobileSession) => Promise<MobileSession>,
  onRefreshed: (session: MobileSession) => void,
): { check: () => void; stop: () => void } {
  let session = initial;
  let active = true;
  let pending = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (retryDelay?: number): void => {
    clearTimeout(timer);
    timer = setTimeout(
      check,
      retryDelay ?? Math.max(1_000, Date.parse(session.accessTokenExpiresAt) - Date.now() - 30_000),
    );
  };
  const check = (): void => {
    if (!active || pending) return;
    if (Date.parse(session.accessTokenExpiresAt) - Date.now() > 30_000) {
      schedule();
      return;
    }
    pending = true;
    void refresh(session)
      .then((next) => {
        if (!active) return;
        session = next;
        onRefreshed(next);
        schedule();
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof Error && error.message === "SESSION_CHANGED"))
          schedule(10_000);
      })
      .finally(() => {
        pending = false;
      });
  };
  check();
  return {
    check,
    stop: () => {
      active = false;
      clearTimeout(timer);
    },
  };
}
