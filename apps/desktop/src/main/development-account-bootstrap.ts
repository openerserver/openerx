import type { AccountState, EmailChallenge } from "@openerx/contracts";

export interface DevelopmentAccountSession {
  initialize(): Promise<AccountState>;
  requestCode(email: string): Promise<EmailChallenge>;
  verifyCode(challengeId: string, code: string): Promise<AccountState>;
}

export interface DevelopmentAccountBootstrap {
  email: string;
  code: string;
}

function normalizedBootstrap(input: DevelopmentAccountBootstrap): DevelopmentAccountBootstrap {
  const email = input.email.trim().toLowerCase();
  const code = input.code.trim();
  if (!/^[^\s@]+@[^\s@]+$/u.test(email)) throw new Error("OPENERX_DEV_EMAIL_INVALID");
  if (!/^\d{6}$/u.test(code)) throw new Error("OPENERX_DEV_EMAIL_CODE_INVALID");
  return { email, code };
}

export async function initializeAccountSession(
  session: DevelopmentAccountSession,
  developmentBootstrap: DevelopmentAccountBootstrap | null,
): Promise<AccountState> {
  const initial = await session.initialize();
  // Automatic development login is only for a fresh profile. A failed refresh
  // must not switch an existing user's data to the configured development account.
  if (!developmentBootstrap || initial.status !== "signed_out" || initial.account) return initial;
  const bootstrap = normalizedBootstrap(developmentBootstrap);
  const challenge = await session.requestCode(bootstrap.email);
  return await session.verifyCode(challenge.challengeId, bootstrap.code);
}
