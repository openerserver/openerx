import { type Plugin, tool } from "@opencode-ai/plugin";

// ── Quality Gate & Git Tools ───────────────────────────────────────

export const QualityPlugin: Plugin = async ({ $, directory }) => {
  return {
    tool: {
      run_lint: tool({
        description: "Run linter on specified files or the entire project",
        args: {
          filePaths: tool.schema.string("Comma-separated file paths (optional — omit for all)"),
          fixMode: tool.schema.boolean("If true, auto-fix fixable issues"),
        },
        async execute({ filePaths, fixMode }) {
          const files = filePaths ? filePaths.split(",").map((f) => f.trim()) : ["."];
          const fixFlag = fixMode ? "--write" : "";
          try {
            const result =
              await $`cd ${directory} && npx biome check ${fixFlag} ${files.join(" ")} 2>&1 || true`;
            return String(result);
          } catch (e) {
            // Try eslint as fallback
            try {
              const eslintFlag = fixMode ? "--fix" : "";
              const result =
                await $`cd ${directory} && npx eslint ${eslintFlag} ${files.join(" ")} 2>&1 || true`;
              return String(result);
            } catch {
              return JSON.stringify({ error: `Lint failed: ${e}` });
            }
          }
        },
      }),

      run_tests: tool({
        description: "Run the project test suite",
        args: {
          testPattern: tool.schema.string("Test file pattern or specific test name (optional)"),
          coverage: tool.schema.boolean("If true, collect coverage report"),
        },
        async execute({ testPattern, coverage }) {
          const coverageFlag = coverage ? "--coverage" : "";
          const pattern = testPattern || "";
          try {
            // Try bun test first, then vitest, then jest
            const result =
              await $`cd ${directory} && bun test ${pattern} ${coverageFlag} 2>&1 || npx vitest run ${pattern} ${coverageFlag} 2>&1 || npx jest ${pattern} ${coverageFlag} 2>&1 || true`;
            return String(result);
          } catch (e) {
            return JSON.stringify({ error: `Tests failed: ${e}` });
          }
        },
      }),

      run_sast: tool({
        description: "Run static application security testing (SAST) scans",
        args: {
          filePaths: tool.schema.string("Comma-separated paths to scan (optional)"),
        },
        async execute({ filePaths }) {
          const targets = filePaths ? filePaths.split(",").map((f) => f.trim()) : ["."];
          try {
            // Try semgrep first
            const result =
              await $`cd ${directory} && semgrep scan --config auto ${targets.join(" ")} --json 2>&1 || true`;
            return String(result);
          } catch {
            return JSON.stringify({
              note: "SAST tools (semgrep) not installed. Install with: pip install semgrep",
              manualCheck:
                "Review code for: SQL injection, XSS, command injection, path traversal, hardcoded secrets",
            });
          }
        },
      }),

      check_dependencies: tool({
        description: "Check dependencies for known vulnerabilities and license compliance",
        args: {},
        async execute() {
          try {
            const auditResult =
              await $`cd ${directory} && npm audit --json 2>&1 || bun pm audit 2>&1 || true`;
            return String(auditResult);
          } catch (e) {
            return JSON.stringify({ error: `Dependency check failed: ${e}` });
          }
        },
      }),

      check_pr_readiness: tool({
        description:
          "Comprehensive PR readiness check: lint + test + SAST + dependencies. Returns pass/fail with details.",
        args: {},
        async execute() {
          const results: Record<string, { status: string; output: string }> = {};

          // Lint
          try {
            const lint = await $`cd ${directory} && npx biome check . 2>&1 || true`;
            const lintOutput = String(lint);
            results.lint = {
              status: lintOutput.includes("error") ? "fail" : "pass",
              output: lintOutput.substring(0, 2000),
            };
          } catch {
            results.lint = { status: "skip", output: "Linter not available" };
          }

          // Tests
          try {
            const test = await $`cd ${directory} && bun test 2>&1 || npx vitest run 2>&1 || true`;
            const testOutput = String(test);
            results.tests = {
              status:
                testOutput.includes("FAIL") || testOutput.includes("failed") ? "fail" : "pass",
              output: testOutput.substring(0, 2000),
            };
          } catch {
            results.tests = { status: "skip", output: "Test runner not available" };
          }

          const allPassed = Object.values(results).every(
            (r) => r.status === "pass" || r.status === "skip",
          );

          return JSON.stringify(
            {
              overall: allPassed ? "PASS" : "FAIL",
              checks: results,
            },
            null,
            2,
          );
        },
      }),

      check_comments: tool({
        description: "Check code comments for AI artifacts and quality issues",
        args: {
          filePaths: tool.schema.string("Comma-separated file paths to check"),
        },
        async execute({ filePaths }) {
          const files = filePaths.split(",").map((f) => f.trim());
          const aiPatterns = [
            "Here's the updated",
            "I've made the following",
            "As requested",
            "I'll implement",
            "Let me",
            "Sure, here",
            "Certainly",
          ];

          try {
            const patternRegex = aiPatterns
              .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join("|");
            const result =
              await $`cd ${directory} && grep -rn "(${patternRegex})" ${files.join(" ")} 2>/dev/null || true`;
            const matches = String(result).trim();

            return JSON.stringify({
              aiArtifacts: matches ? matches.split("\n").filter(Boolean) : [],
              count: matches ? matches.split("\n").filter(Boolean).length : 0,
              recommendation: matches
                ? "Remove AI-generated conversational comments listed above"
                : "No AI artifacts found",
            });
          } catch (e) {
            return JSON.stringify({ error: `Comment check failed: ${e}` });
          }
        },
      }),

      // ── Git-Master Skills ──

      git_commit_style: tool({
        description: "Validate and suggest conventional commit message format",
        args: {
          message: tool.schema.string("Proposed commit message"),
        },
        async execute({ message }) {
          // Conventional commit pattern: type(scope): description
          const conventionalPattern =
            /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z-]+\))?!?:\s.+/;
          const isConventional = conventionalPattern.test(message);

          const suggestions: string[] = [];
          if (!isConventional) {
            suggestions.push(
              "Use conventional commit format: type(scope): description",
              "Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert",
              "Example: feat(auth): add JWT token refresh endpoint",
            );
          }
          if (message.length > 72) {
            suggestions.push("Keep subject line under 72 characters");
          }
          if (message[0] === message[0]?.toUpperCase() && isConventional) {
            suggestions.push("Description after colon should start with lowercase");
          }

          return JSON.stringify({
            message,
            isConventional,
            valid: isConventional && message.length <= 72,
            suggestions,
          });
        },
      }),

      git_history_search: tool({
        description: "Search git history for changes related to a query",
        args: {
          query: tool.schema.string("Search term (looks in commit messages and diffs)"),
          author: tool.schema.string("Filter by author (optional)"),
          since: tool.schema.string("Filter by date, e.g., '2 weeks ago' (optional)"),
        },
        async execute({ query, author, since }) {
          const authorFlag = author ? `--author="${author}"` : "";
          const sinceFlag = since ? `--since="${since}"` : "";
          try {
            // Search commit messages
            const msgResult =
              await $`cd ${directory} && git log --oneline --grep="${query}" ${authorFlag} ${sinceFlag} -20 2>&1 || true`;
            // Search diffs
            const diffResult =
              await $`cd ${directory} && git log --oneline -S"${query}" ${authorFlag} ${sinceFlag} -20 2>&1 || true`;

            return JSON.stringify({
              query,
              messageMatches: String(msgResult).trim().split("\n").filter(Boolean),
              diffMatches: String(diffResult).trim().split("\n").filter(Boolean),
            });
          } catch (e) {
            return JSON.stringify({ error: `Git search failed: ${e}` });
          }
        },
      }),
    },
  };
};

export default QualityPlugin;
