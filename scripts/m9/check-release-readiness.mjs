import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const modeIndex = process.argv.indexOf("--mode");
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : "local";
if (mode !== "local" && mode !== "publish") throw new Error("RELEASE_GATE_MODE_INVALID");

function json(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

const rootPackage = json("package.json");
const desktopPackage = json("apps/desktop/package.json");
const m8 = json("tests/v2/golden/m8-gate-status.json");
const m9 = json("tests/v2/golden/m9-gate-status.json");
const personalProjects = json("tests/v2/golden/personal-projects-gate-status.json");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

for (const [name, ledger] of Object.entries({ m8, m9, personalProjects })) {
  assert(ledger.scope === "open-source-desktop", `${name} is not a public desktop release ledger`);
  const requirements = [
    ...(ledger.externalBeta?.requiredEvidence ?? []),
    ...(ledger.externalRelease?.requiredEvidence ?? []),
  ];
  assert(
    requirements.every(
      (item) => !/ios|android|alipay|wechat|merchant|tax|store-signing/iu.test(item),
    ),
    `${name} contains non-desktop publication requirements`,
  );
}

assert(rootPackage.version === desktopPackage.version, "desktop version must match root version");
assert(
  m9.localImplementation?.status === "complete",
  "M9 local implementation ledger is incomplete",
);
assert(personalProjects.schemaVersion === 1, "Personal Projects gate schema is unsupported");
assert(
  personalProjects.localImplementation?.status === "complete",
  "Personal Projects local implementation ledger is incomplete",
);
assert(
  personalProjects.localImplementation?.completedSlices ===
    personalProjects.localImplementation?.expectedSlices,
  "Personal Projects implementation slices are incomplete",
);
assert(
  personalProjects.localImplementation?.electronE2E === "pass",
  "Personal Projects Electron E2E evidence is missing",
);
const personalProjectEvidence = personalProjects.localImplementation?.requiredEvidence ?? [];
assert(
  personalProjectEvidence.length === personalProjects.localImplementation?.evidenceRecords,
  "Personal Projects public evidence count does not match its ledger",
);
for (const evidence of personalProjectEvidence) {
  assert(existsSync(path.join(root, evidence)), `missing Personal Projects evidence: ${evidence}`);
}
const personalProjectReleaseNotes = personalProjects.localImplementation?.releaseNotes;
assert(
  typeof personalProjectReleaseNotes === "string" &&
    personalProjectReleaseNotes.length > 0 &&
    existsSync(path.join(root, personalProjectReleaseNotes)),
  "Personal Projects release notes are missing",
);
assert(
  personalProjects.releaseClaim ===
    (personalProjects.externalRelease?.status === "approved" &&
      personalProjects.externalRelease?.publishAllowed === true),
  "Personal Projects release claim does not match external approval state",
);

if (mode === "publish") {
  assert(!rootPackage.version.includes("-"), "publish version must not be a prerelease");
  assert(m8.externalBeta?.status === "complete", "M8 external Beta is not complete");
  assert(m9.externalRelease?.status === "approved", "M9 external release is not approved");
  assert(m9.externalRelease?.userApproval === true, "explicit user release approval is missing");
  assert(
    personalProjects.externalBeta?.status === "complete",
    "Personal Projects external Beta is not complete",
  );
  assert(
    personalProjects.externalRelease?.status === "approved",
    "Personal Projects external release is not approved",
  );
  assert(
    personalProjects.externalRelease?.userApproval === true,
    "Personal Projects explicit release approval is missing",
  );
  assert(
    personalProjects.externalRelease?.publishAllowed === true &&
      personalProjects.releaseClaim === true,
    "Personal Projects publish claim is blocked",
  );
  const projectBetaCompleted = new Set(personalProjects.externalBeta?.completedEvidence ?? []);
  for (const evidence of personalProjects.externalBeta?.requiredEvidence ?? []) {
    assert(
      projectBetaCompleted.has(evidence),
      `missing Personal Projects Beta evidence: ${evidence}`,
    );
  }
  const projectReleaseCompleted = new Set(
    personalProjects.externalRelease?.completedEvidence ?? [],
  );
  for (const evidence of personalProjects.externalRelease?.requiredEvidence ?? []) {
    assert(
      projectReleaseCompleted.has(evidence),
      `missing Personal Projects release evidence: ${evidence}`,
    );
  }
  const completed = new Set(m9.externalRelease?.completedEvidence ?? []);
  for (const evidence of m9.externalRelease?.requiredEvidence ?? []) {
    assert(completed.has(evidence), `missing external release evidence: ${evidence}`);
  }
}

if (failures.length > 0) {
  console.error(`[m9-release-gate] ${mode.toUpperCase()} BLOCKED`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const remaining = (m9.externalRelease?.requiredEvidence ?? []).filter(
    (item) => !(m9.externalRelease?.completedEvidence ?? []).includes(item),
  ).length;
  console.log(
    `[m9-release-gate] ${mode.toUpperCase()} OK: local release foundation is consistent; ${remaining} external evidence groups remain.`,
  );
}
