import { type Plugin, tool } from "@opencode-ai/plugin";

// ── Ops Runbook Tools ──────────────────────────────────────────────

export const OpsRunbookPlugin: Plugin = async ({ $, directory }) => {
  return {
    tool: {
      query_logs: tool({
        description: "Query application logs with filtering",
        args: {
          service: tool.schema.string("Service name or log file path"),
          timeRange: tool.schema.string("Time range, e.g., '1h', '30m', '2024-01-01 to 2024-01-02'"),
          query: tool.schema.string("Search query (regex supported)"),
          limit: tool.schema.number("Maximum lines to return (default: 100)"),
        },
        async execute({ service, timeRange, query, limit }) {
          const maxLines = limit || 100;

          try {
            // Try journalctl first (systemd)
            const sinceFlag = timeRange.includes("to") ? "" : `--since="${timeRange} ago"`;
            const result =
              await $`journalctl -u ${service} ${sinceFlag} --no-pager -n ${maxLines} 2>/dev/null | grep -E "${query}" || true`;
            const output = String(result).trim();

            if (output) {
              return JSON.stringify({
                source: "journalctl",
                service,
                timeRange,
                query,
                lines: output.split("\n").filter(Boolean),
                count: output.split("\n").filter(Boolean).length,
              });
            }

            // Fallback: search log files
            const logResult =
              await $`find /var/log -name "*${service}*" -type f 2>/dev/null | head -5 || true`;
            const logFiles = String(logResult).trim().split("\n").filter(Boolean);

            if (logFiles.length > 0) {
              const grepResult =
                await $`grep -h "${query}" ${logFiles[0]} 2>/dev/null | tail -${maxLines} || true`;
              return JSON.stringify({
                source: "log_file",
                file: logFiles[0],
                lines: String(grepResult).trim().split("\n").filter(Boolean),
              });
            }

            return JSON.stringify({
              note: "No logs found. Verify service name and log location.",
              tried: ["journalctl", "/var/log/"],
            });
          } catch (e) {
            return JSON.stringify({ error: `Log query failed: ${e}` });
          }
        },
      }),

      query_metrics: tool({
        description: "Query monitoring metrics (Prometheus-compatible endpoint)",
        args: {
          metric: tool.schema.string("Metric name (e.g., 'http_requests_total')"),
          timeRange: tool.schema.string("Time range: '5m', '1h', '24h'"),
          labels: tool.schema.string("Label filters as JSON (optional), e.g., '{\"job\":\"api\"}'"),
        },
        async execute({ metric, timeRange, labels }) {
          const labelFilters = labels ? JSON.parse(labels) : {};
          const labelStr = Object.entries(labelFilters)
            .map(([k, v]) => `${k}="${v}"`)
            .join(",");
          const query = labelStr ? `${metric}{${labelStr}}` : metric;

          // Default Prometheus endpoint
          const prometheusUrl =
            process.env.PROMETHEUS_URL || "http://localhost:9090";

          try {
            const result =
              await $`curl -s "${prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}" 2>&1 || true`;
            const data = JSON.parse(String(result));
            return JSON.stringify(data, null, 2);
          } catch {
            return JSON.stringify({
              note: `Prometheus not reachable at ${prometheusUrl}. Configure PROMETHEUS_URL env var.`,
              query,
              timeRange,
            });
          }
        },
      }),

      diagnose_issue: tool({
        description:
          "Run a structured diagnosis workflow: gather logs + metrics → build timeline → identify root cause",
        args: {
          symptom: tool.schema.string("Description of the observed problem"),
          service: tool.schema.string("Affected service name"),
        },
        async execute({ symptom, service }) {
          const diagnosis: Record<string, unknown> = {
            symptom,
            service,
            startedAt: new Date().toISOString(),
          };

          // Step 1: Get recent error logs
          try {
            const errors =
              await $`journalctl -u ${service} --since="1 hour ago" --no-pager -p err 2>/dev/null | tail -20 || true`;
            diagnosis.recentErrors = String(errors).trim().split("\n").filter(Boolean);
          } catch {
            diagnosis.recentErrors = ["Could not fetch error logs"];
          }

          // Step 2: Get service status
          try {
            const status = await $`systemctl status ${service} 2>/dev/null || true`;
            diagnosis.serviceStatus = String(status).trim();
          } catch {
            diagnosis.serviceStatus = "Could not fetch service status";
          }

          // Step 3: Check resource usage
          try {
            const resources = await $`ps aux | grep ${service} | head -5 || true`;
            diagnosis.resourceUsage = String(resources).trim();
          } catch {
            diagnosis.resourceUsage = "Could not fetch resource info";
          }

          // Step 4: Check disk space
          try {
            const disk = await $`df -h / /var /tmp 2>/dev/null || true`;
            diagnosis.diskSpace = String(disk).trim();
          } catch {
            diagnosis.diskSpace = "Could not check disk space";
          }

          return JSON.stringify(
            {
              ...diagnosis,
              note: "Review the gathered data above. Based on the error logs, service status, and resource usage, determine the root cause and recommended remediation.",
            },
            null,
            2,
          );
        },
      }),

      execute_runbook: tool({
        description:
          "Execute a predefined runbook step. PRODUCTION environments require human approval.",
        args: {
          runbookId: tool.schema.string("Runbook identifier (e.g., 'restart-service', 'clear-cache')"),
          params: tool.schema.string("JSON parameters for the runbook step"),
          environment: tool.schema.string("Target environment: dev|staging|production"),
        },
        async execute({ runbookId, params, environment }) {
          const parsedParams = JSON.parse(params || "{}");

          // SAFETY: Production requires explicit approval
          if (environment === "production") {
            return JSON.stringify({
              status: "APPROVAL_REQUIRED",
              runbookId,
              environment,
              params: parsedParams,
              message: "Production runbook execution requires human approval via Web UI.",
              approvalAction: "Submit an approval ticket via the Control Plane.",
            });
          }

          // Known runbooks
          const runbooks: Record<string, string> = {
            "restart-service": `systemctl restart ${parsedParams.service || "unknown"}`,
            "clear-cache": `redis-cli FLUSHDB`,
            "rotate-logs": `logrotate -f /etc/logrotate.d/${parsedParams.service || "unknown"}`,
            "check-connectivity": `curl -sf ${parsedParams.url || "http://localhost"}/health`,
          };

          const command = runbooks[runbookId];
          if (!command) {
            return JSON.stringify({
              error: `Unknown runbook: ${runbookId}`,
              available: Object.keys(runbooks),
            });
          }

          // Preview before execution
          return JSON.stringify({
            status: "PREVIEW",
            runbookId,
            environment,
            command,
            params: parsedParams,
            message:
              "Review the command above. Confirm execution by calling this tool again with the same parameters.",
          });
        },
      }),

      generate_postmortem: tool({
        description: "Generate a structured post-incident review document",
        args: {
          incidentTitle: tool.schema.string("Incident title"),
          timeline: tool.schema.string("JSON array of timeline events: [{time, event}]"),
          rootCause: tool.schema.string("Root cause analysis"),
          impact: tool.schema.string("Impact description"),
          resolution: tool.schema.string("How the incident was resolved"),
        },
        async execute({ incidentTitle, timeline, rootCause, impact, resolution }) {
          const timelineEvents = JSON.parse(timeline || "[]") as Array<{
            time: string;
            event: string;
          }>;

          const postmortem = `# Post-Incident Review: ${incidentTitle}

## Date
${new Date().toISOString().split("T")[0]}

## Summary
${incidentTitle}

## Impact
${impact}

## Timeline
${timelineEvents.map((e) => `- **${e.time}**: ${e.event}`).join("\n")}

## Root Cause
${rootCause}

## Resolution
${resolution}

## Action Items
- [ ] TODO: Add preventive measures
- [ ] TODO: Update monitoring/alerts
- [ ] TODO: Update runbooks
- [ ] TODO: Schedule follow-up review

## Lessons Learned
- TODO: Document key takeaways
`;

          return postmortem;
        },
      }),
    },
  };
};

export default OpsRunbookPlugin;
