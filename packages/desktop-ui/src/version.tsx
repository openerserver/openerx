import { useState } from "react";

export interface VersionInfo {
  version: string;
  buildId: string;
  builtAt: string;
  revision: string;
  dirty: boolean;
}

export function AppVersion({ info }: { info?: VersionInfo }): React.JSX.Element | null {
  const [notice, setNotice] = useState("");
  if (!info) return null;
  const details = `版本 ${info.version}\n构建 ${info.buildId}\n代码 ${info.revision}${info.dirty ? "（本地修改）" : ""}`;
  return (
    <section className="settings-version" aria-label="应用版本">
      <strong>版本 {info.version}</strong>
      <span>构建于 {new Date(info.builtAt).toLocaleString("zh-CN", { hour12: false })}</span>
      <button
        type="button"
        title={details}
        onClick={() => {
          void navigator.clipboard.writeText(details).then(
            () => setNotice("版本信息已复制"),
            () => setNotice("复制失败，请重试"),
          );
        }}
      >
        复制版本信息
      </button>
      {notice ? <span role="status">{notice}</span> : null}
    </section>
  );
}
