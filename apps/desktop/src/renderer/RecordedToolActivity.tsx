import type { WorkItem } from "@openerx/contracts";

const statuses = { running: "运行中", completed: "已完成", failed: "失败", cancelled: "已取消" };
const toolStatuses = { started: "执行中", completed: "已完成", failed: "失败" };
const permissions = { pending: "待审批", once: "已单次批准", deny: "已拒绝" };

/** Saved summaries are evidence, not live tool calls or permission controls. */
export function RecordedToolActivity({
  workItem,
}: {
  workItem: WorkItem;
}): React.JSX.Element | null {
  const record = workItem.recordedActivity;
  if (!record) return null;
  return (
    <details
      className="tool-activity"
      open={["running", "failed"].includes(record.status) || undefined}
    >
      <summary>
        <span className="tool-activity-heading">
          <strong>{workItem.title}</strong>
        </span>
        <span className={`tool-state tool-state-${record.status}`}>{statuses[record.status]}</span>
      </summary>
      <p className="muted-copy">已保存的执行摘要 · {record.modelRef}</p>
      <p className="muted-copy">
        开始 <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time>
        {record.completedAt ? (
          <>
            {" "}
            · 结束{" "}
            <time dateTime={record.completedAt}>
              {new Date(record.completedAt).toLocaleString()}
            </time>
          </>
        ) : null}
      </p>
      {record.bindings.length ? (
        <section aria-label="已挂载技能">
          <strong>已挂载技能</strong>
          <ul>
            {record.bindings.map((binding) => (
              <li key={binding.installationId}>
                {binding.name} · {binding.version}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="run-timeline">
        {record.tools.map((tool) => (
          <section className="run-item-row tool-call-row" key={`${record.runId}:${tool.callId}`}>
            <header>
              <strong>{tool.name}</strong>
              <span>{toolStatuses[tool.status]}</span>
            </header>
            {tool.permission ? <p>{permissions[tool.permission]}</p> : null}
            {tool.summary ? <p>{tool.summary}</p> : null}
            {tool.errorCode ? <p className="inline-error">{tool.errorCode}</p> : null}
          </section>
        ))}
      </div>
      {record.errorCode ? <p className="inline-error">{record.errorCode}</p> : null}
    </details>
  );
}
