#!/usr/bin/env bun
/**
 * CLI: Create a task and optionally execute it via the BFF.
 *
 * Usage:
 *   bun run src/cli/create-task.ts --title "Fix login bug" --prompt "Investigate and fix..." [--execute] [--user admin] [--password admin123!]
 *
 * Environment variables (override flags):
 *   OPENERX_BFF_URL    (default: http://localhost:4098)
 *   OPENERX_USERNAME   (default: admin)
 *   OPENERX_PASSWORD   (default: admin123!)
 */

const BFF_URL = process.env.OPENERX_BFF_URL || "http://localhost:4098";

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        parsed[key] = next;
        i++;
      } else {
        flags.add(key);
      }
    }
  }
  return { parsed, flags };
}

async function apiFetch<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BFF_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...opts?.headers,
    },
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function main() {
  const { parsed, flags } = parseArgs();

  if (flags.has("help") || flags.has("h")) {
    console.log(`
Usage: bun run src/cli/create-task.ts [options]

Options:
  --title <title>       Task title (required)
  --prompt <prompt>     Task prompt/description (required, or use --file)
  --file <path>         Read prompt from a file instead of --prompt
  --execute             Immediately start agent execution after creation
  --user <username>     Login username (default: admin / OPENERX_USERNAME)
  --password <pass>     Login password (default: admin123! / OPENERX_PASSWORD)
  --help                Show this help message
`);
    process.exit(0);
  }

  const title = parsed.title;
  let prompt = parsed.prompt;
  const promptFile = parsed.file;
  const autoExecute = flags.has("execute");
  const username = parsed.user || process.env.OPENERX_USERNAME || "admin";
  const password = parsed.password || process.env.OPENERX_PASSWORD || "admin123!";

  if (!title) {
    console.error("Error: --title is required");
    process.exit(1);
  }

  if (promptFile) {
    const file = Bun.file(promptFile);
    if (!(await file.exists())) {
      console.error(`Error: file not found: ${promptFile}`);
      process.exit(1);
    }
    prompt = await file.text();
  }

  if (!prompt) {
    console.error("Error: --prompt or --file is required");
    process.exit(1);
  }

  // 1. Login
  console.log(`Logging in as ${username}...`);
  const loginResult = await apiFetch<{
    token: string;
    user: { id: string; projects?: Array<{ id: string }> };
  }>("/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const token = loginResult.token;
  const projectId = loginResult.user.projects?.[0]?.id;

  if (!projectId) {
    console.error("Error: user has no project assigned");
    process.exit(1);
  }
  console.log(`  ✓ Authenticated (project: ${projectId.slice(0, 8)})`);

  // 2. Create task
  console.log(`Creating task: "${title}"...`);
  const task = await apiFetch<{ id: string; status: string }>("/api/tasks", token, {
    method: "POST",
    body: JSON.stringify({ title, prompt, projectId }),
  });
  console.log(`  ✓ Task created: ${task.id}`);

  // 3. Execute (optional)
  if (autoExecute) {
    console.log("Starting agent execution...");
    try {
      const execResult = await apiFetch<{
        taskId: string;
        sessionId: string;
        agentRunId: string;
        status: string;
      }>(`/api/tasks/${task.id}/execute`, token, { method: "POST" });
      console.log(`  ✓ Agent started`);
      console.log(`    taskId:     ${execResult.taskId}`);
      console.log(`    sessionId:  ${execResult.sessionId}`);
      console.log(`    agentRunId: ${execResult.agentRunId}`);
    } catch (e) {
      console.error(`  ✗ Execution failed: ${e}`);
      console.log("  Task was created but agent did not start. You can execute later via UI.");
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(`Fatal: ${e}`);
  process.exit(1);
});
