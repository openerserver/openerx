export function PiRuntimeSettingsPanel({
  enabled,
  pending,
  error,
  onChange,
}: {
  enabled: boolean;
  pending: boolean;
  error?: string;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <section className="settings-card settings-stack" aria-label="工具批量编排（实验）">
      <div className="settings-heading">
        <div>
          <h3>工具批量编排（实验）</h3>
          <p>按需发现并批量调用已有授权工具，用于需要多个步骤的任务。</p>
        </div>
      </div>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>启用工具批量编排</span>
      </label>
      <p className="settings-note">
        默认关闭，仅对本机当前账户生效。开启后新任务可使用此功能，仍按已有权限执行。
        关闭会停止正在使用此功能的任务，已完成的操作保留在任务记录中。
      </p>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
