import { desktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { useMutation, useQuery } from "@tanstack/react-query";

/** Legacy export is a separate read-only host surface; personal export follows its current profile. */
export function LocalDataExportSettings({
  legacy = false,
}: {
  legacy?: boolean;
}): React.JSX.Element {
  const summary = useQuery({
    queryKey: [legacy ? "legacy-personal-data" : "personal-data", "summary"],
    queryFn: () =>
      legacy
        ? window.openerx.getLegacyPersonalDataSummary()
        : desktopWorkspaceBridge().getPersonalDataSummary(),
    retry: false,
  });
  const exportData = useMutation({
    mutationFn: () =>
      legacy
        ? window.openerx.exportLegacyPersonalData()
        : desktopWorkspaceBridge().exportPersonalData(),
  });
  const title = legacy ? "本机旧版数据" : "本机个人数据";
  return (
    <section className="personal-data-summary settings-stack" aria-label={title}>
      <div>
        <strong>{title}</strong>
        {summary.isPending ? <p role="status">正在读取本机数据…</p> : null}
        {summary.error ? (
          <p role="alert">暂时无法读取本机数据，原有记录仍保留。请重试。</p>
        ) : summary.data ? (
          <span>
            {summary.data.conversations} 个对话 · {summary.data.messages} 条消息 ·{" "}
            {summary.data.files} 个文件 · {summary.data.artifacts} 个成果 · {summary.data.memories}{" "}
            条记忆
          </span>
        ) : null}
        <small>
          {legacy ? "只读取此电脑保留的旧版数据库，不包含企业聊天。" : "只导出当前本机个人数据库。"}
          Token、报价、费用和账单只读取服务端记录，不写入此本地导出。
        </small>
      </div>
      <div className="settings-actions">
        {summary.error ? (
          <button
            type="button"
            onClick={() => void summary.refetch()}
            disabled={summary.isFetching}
          >
            重新读取本机数据
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => exportData.mutate()}
          disabled={!summary.data || Boolean(summary.error) || exportData.isPending}
        >
          {exportData.isPending ? "正在导出…" : legacy ? "导出旧版数据" : "导出个人数据"}
        </button>
      </div>
      {exportData.data ? (
        <p role="status">
          {legacy ? "旧版数据" : "个人数据"}已保存：{exportData.data.fileName}
        </p>
      ) : null}
      {exportData.error ? <p role="alert">数据导出失败，请重新选择保存位置后重试。</p> : null}
    </section>
  );
}
