import path from "node:path";
import type { AccountState } from "@openerx/contracts";

interface ProfilePaths {
  getPath(name: "appData"): string;
  setPath(name: "userData" | "sessionData", value: string): void;
  isPackaged?: boolean;
}

export function configureDesktopProfile(
  app: ProfilePaths,
  environment: NodeJS.ProcessEnv = process.env,
  profileDirectoryName = "OpenerX",
): string {
  const testDirectory =
    environment.OPENERX_E2E === "1" ? environment.OPENERX_E2E_PROFILE_DIR : undefined;
  // Persistent identity must not depend on the executable, build, version or display name.
  // Keep the original on-disk name for existing installations. Development
  // builds use a sibling profile so they cannot wake legacy credentials in a
  // packaged profile and trigger its old OS credential prompt.
  const normalDirectoryName =
    app.isPackaged === false ? `${profileDirectoryName}-Development` : profileDirectoryName;
  const directory = testDirectory
    ? path.resolve(testDirectory)
    : path.join(app.getPath("appData"), normalDirectoryName);
  app.setPath("userData", directory);
  app.setPath("sessionData", directory);
  return directory;
}

export function accountProfileDirectory(
  baseDirectory: string,
  account: AccountState["account"],
): string {
  return account ? path.join(baseDirectory, "accounts", account.accountId) : baseDirectory;
}
