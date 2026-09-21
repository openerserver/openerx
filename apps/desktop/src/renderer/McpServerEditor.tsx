import {
  type DesktopMcpServerSaveInput,
  desktopMcpServerSaveInputSchema,
  type McpServerConfig,
  type McpServerPreset,
} from "@openerx/contracts";
import { X } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseMcpArguments, parseMcpImport, parseMcpValues } from "./mcp-config";
import { commonMcpPresets } from "./mcp-presets";

export function McpServerEditor({
  server,
  existingNames,
  additionalPresets = [],
  onSaved,
  onClose,
  errorMessage,
}: {
  server?: McpServerConfig;
  existingNames: string[];
  additionalPresets?: readonly McpServerPreset[];
  onSaved: (saved: McpServerConfig[], complete: boolean) => Promise<void>;
  onClose: () => void;
  errorMessage: (error: unknown, fallback: string) => string;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"manual" | "json">("manual");
  const [preset, setPreset] = useState<McpServerPreset | null>(null);
  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState(server?.transport ?? "stdio");
  const [endpoint, setEndpoint] = useState(
    server?.transport === "stdio" ? server.command : (server?.url ?? ""),
  );
  const [args, setArgs] = useState(
    server?.transport === "stdio" ? JSON.stringify(server.args) : "",
  );
  const [cwd, setCwd] = useState(server?.transport === "stdio" ? server.cwd : "");
  const [values, setValues] = useState("");
  const [auth, setAuth] = useState(server?.transport === "streamable_http" ? server.auth : "none");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [scope, setScope] = useState("");
  const [json, setJson] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [imported, setImported] = useState<string[]>([]);
  const parsedImport = useMemo(() => {
    if (!json.trim()) return { inputs: [], error: null };
    try {
      return { inputs: parseMcpImport(json), error: null };
    } catch (error) {
      return { inputs: [], error: (error as Error).message };
    }
  }, [json]);
  const save = useMutation({
    mutationFn: async (inputs: DesktopMcpServerSaveInput[]) => {
      const saved: McpServerConfig[] = [];
      for (const input of inputs) {
        if (imported.includes(input.config.id)) continue;
        const result = await window.openerx.saveMcpServer(input);
        saved.push(result);
        if (mode === "json") {
          setImported((current) => [...current, result.id]);
          await onSaved([result], false);
        }
      }
      return saved;
    },
    onSuccess: async (saved) => onSaved(saved, true),
  });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (typeof dialog?.showModal === "function") dialog.showModal();
    else dialog?.setAttribute("open", "");
    return () => {
      if (typeof dialog?.close === "function" && dialog.open) dialog.close();
    };
  }, []);
  const savedValueNames = server?.transport === "stdio" ? server.envKeys : server?.headerNames;
  const title = server ? "编辑 MCP 服务" : "添加工具";
  const applyPreset = (next: McpServerPreset) => {
    setPreset(next);
    setName(next.name);
    setTransport("streamable_http");
    setEndpoint(next.url);
    setAuth(next.auth);
    setArgs("");
    setCwd("");
    setValues("");
    setToken("");
    setClientId("");
    setScope("");
    setValidationError(null);
    save.reset();
  };
  const submit = () => {
    setValidationError(null);
    try {
      let inputs: DesktopMcpServerSaveInput[];
      if (mode === "json") {
        if (parsedImport.error) throw new Error(parsedImport.error);
        if (!parsedImport.inputs.length) throw new Error("请先粘贴 MCP JSON 配置。");
        inputs = parsedImport.inputs;
      } else {
        const common = {
          id: server?.id ?? crypto.randomUUID(),
          name: name.trim(),
          enabled: server?.enabled ?? true,
          enabledTools: server?.enabledTools ?? [],
        };
        const input: DesktopMcpServerSaveInput =
          transport === "stdio"
            ? {
                config: {
                  ...common,
                  transport,
                  command: endpoint.trim(),
                  args: parseMcpArguments(args),
                  cwd: cwd.trim(),
                },
                ...(values.trim() ? { env: parseMcpValues(values, "env") } : {}),
              }
            : {
                config: {
                  ...common,
                  transport,
                  url: endpoint.trim(),
                  auth,
                  credentialRef:
                    server?.transport === "streamable_http" ? server.credentialRef : null,
                },
                ...(values.trim() ? { headers: parseMcpValues(values, "headers") } : {}),
                ...(auth === "bearer" && token ? { bearerToken: token } : {}),
                ...(auth === "oauth" && clientId.trim() ? { oauthClientId: clientId.trim() } : {}),
                ...(auth === "oauth" && scope.trim() ? { oauthScope: scope.trim() } : {}),
              };
        if (
          transport === "streamable_http" &&
          auth === "bearer" &&
          !token &&
          !(
            server?.transport === "streamable_http" &&
            server.auth === "bearer" &&
            server.url === endpoint.trim() &&
            server.credentialRef
          )
        ) {
          throw new Error("请填写此服务的 Bearer 令牌。");
        }
        const parsed = desktopMcpServerSaveInputSchema.safeParse(input);
        if (!parsed.success)
          throw new Error("请检查名称、启动命令或 HTTP 服务地址，以及字段长度。");
        inputs = [parsed.data];
      }
      const existing = new Set(
        existingNames
          .filter((item) => item !== server?.name)
          .map((item) => item.trim().toLocaleLowerCase()),
      );
      const conflict = inputs.find(
        (input) =>
          !imported.includes(input.config.id) &&
          existing.has(input.config.name.toLocaleLowerCase()),
      );
      if (conflict) throw new Error(`已存在“${conflict.config.name}”，请修改名称或编辑已有服务。`);
      save.mutate(inputs);
    } catch (error) {
      setValidationError((error as Error).message);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="tool-modal tool-add-modal mcp-editor-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!save.isPending) onClose();
      }}
    >
      <header className="tool-modal-header">
        <div>
          <h2>{title}</h2>
          <p>连接本机 MCP 进程或网络工具服务，供对话使用。</p>
        </div>
        <button type="button" aria-label="关闭添加工具" disabled={save.isPending} onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <form
        className="mcp-config-form tool-add-form"
        aria-label={server ? "编辑 MCP 服务" : "添加 MCP 服务"}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {!server ? (
          <div className="tool-category-tabs" role="tablist" aria-label="添加方式">
            {(
              [
                ["manual", "手动填写"],
                ["json", "JSON 导入"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                className={mode === value ? "is-active" : ""}
                disabled={save.isPending || imported.length > 0}
                onClick={() => {
                  setMode(value);
                  setValidationError(null);
                  save.reset();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <fieldset className="mcp-editor-fields" disabled={save.isPending}>
          {mode === "json" ? (
            <>
              <label className="mcp-field">
                <span>MCP JSON 配置</span>
                <textarea
                  aria-label="MCP JSON 配置"
                  rows={10}
                  spellCheck={false}
                  value={json}
                  disabled={imported.length > 0}
                  placeholder={
                    '{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "your-mcp-package"]\n    }\n  }\n}'
                  }
                  onChange={(event) => {
                    setJson(event.target.value);
                    setValidationError(null);
                    save.reset();
                  }}
                />
                <small>
                  支持 mcpServers 对象、单个服务和以名称为键的配置。导入前可在下方检查服务清单。
                </small>
              </label>
              {parsedImport.error ? (
                <p className="inline-error" role="alert">
                  {parsedImport.error}
                </p>
              ) : null}
              {parsedImport.inputs.length ? (
                <ul className="mcp-import-preview" aria-label="待导入 MCP 服务">
                  {parsedImport.inputs.map(({ config }) => (
                    <li key={config.id}>
                      <strong>{config.name}</strong>
                      <span>
                        {config.transport === "stdio" ? "本机进程" : "网络服务"} ·{" "}
                        {imported.includes(config.id)
                          ? "已导入"
                          : config.enabled
                            ? "导入后启用"
                            : "导入后停用"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <>
              {!server ? (
                <section className="mcp-presets" aria-label="MCP 快捷配置">
                  <strong>快捷配置</strong>
                  <div className="mcp-preset-list">
                    {[...commonMcpPresets, ...additionalPresets].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="mcp-preset-card"
                        aria-label={`配置 ${item.name}`}
                        aria-pressed={preset?.id === item.id}
                        onClick={() => applyPreset(item)}
                      >
                        <strong>{item.name}</strong>
                        <span>{item.description}</span>
                      </button>
                    ))}
                  </div>
                  {preset ? (
                    <p className="mcp-preset-hint" role="status">
                      {preset.hint}{" "}
                      {preset.documentationUrl ? (
                        <a href={preset.documentationUrl} target="_blank" rel="noreferrer">
                          官方配置说明 ↗
                        </a>
                      ) : null}
                    </p>
                  ) : null}
                </section>
              ) : null}
              <label className="mcp-field">
                <span>显示名称</span>
                <input
                  aria-label="MCP 名称"
                  required
                  maxLength={200}
                  placeholder="例如：项目知识库"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="mcp-field">
                <span>连接方式</span>
                <select
                  aria-label="MCP 传输"
                  value={transport}
                  disabled={Boolean(server)}
                  onChange={(event) => {
                    setTransport(event.target.value as typeof transport);
                    setPreset(null);
                    setEndpoint("");
                    setValues("");
                  }}
                >
                  <option value="stdio">本机进程（STDIO）</option>
                  <option value="streamable_http">网络服务（Streamable HTTP）</option>
                </select>
              </label>
              <label className="mcp-field">
                <span>{transport === "stdio" ? "启动命令" : "服务地址"}</span>
                <input
                  aria-label={transport === "stdio" ? "MCP 命令" : "MCP URL"}
                  required
                  value={endpoint}
                  onChange={(event) => {
                    setEndpoint(event.target.value);
                    if (preset?.url) setPreset(null);
                  }}
                  placeholder={
                    transport === "stdio"
                      ? "npx、uvx 或可执行文件的完整路径"
                      : "https://example.com/mcp"
                  }
                />
                {transport === "stdio" ? <small>这里只填写命令；启动参数填写在下方。</small> : null}
              </label>
              {transport === "stdio" ? (
                <>
                  <label className="mcp-field">
                    <span>启动参数（可选）</span>
                    <textarea
                      aria-label="MCP 参数"
                      rows={3}
                      spellCheck={false}
                      value={args}
                      onChange={(event) => setArgs(event.target.value)}
                      placeholder={"-y\nyour-mcp-package\n/Users/name/My Project"}
                    />
                    <small>
                      每行一个参数，或填写 JSON 字符串数组。含空格的路径也占一行，无需加引号。
                    </small>
                  </label>
                  <label className="mcp-field">
                    <span>工作目录（可选）</span>
                    <input
                      aria-label="MCP 工作目录"
                      value={cwd}
                      onChange={(event) => setCwd(event.target.value)}
                      placeholder="留空使用当前用户的主目录"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="mcp-field">
                    <span>认证方式</span>
                    <select
                      aria-label="MCP 认证"
                      value={auth}
                      onChange={(event) => setAuth(event.target.value as typeof auth)}
                    >
                      <option value="none">无认证 / 自定义请求头</option>
                      <option value="bearer">Bearer 令牌</option>
                      <option value="oauth">OAuth 授权码（PKCE）</option>
                    </select>
                  </label>
                  {auth === "bearer" ? (
                    <label className="mcp-field">
                      <span>Bearer 令牌</span>
                      <input
                        aria-label="MCP Bearer Token"
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder={server ? "留空保留已有令牌" : "粘贴服务令牌"}
                      />
                    </label>
                  ) : null}
                  {auth === "oauth" ? (
                    <>
                      <label className="mcp-field">
                        <span>OAuth Client ID（可选）</span>
                        <input
                          aria-label="MCP OAuth Client ID"
                          value={clientId}
                          onChange={(event) => setClientId(event.target.value)}
                          placeholder={server ? "留空保留已有授权配置" : "留空则尝试动态客户端注册"}
                        />
                      </label>
                      <label className="mcp-field">
                        <span>OAuth Scope（可选）</span>
                        <input
                          aria-label="MCP OAuth Scope"
                          value={scope}
                          onChange={(event) => setScope(event.target.value)}
                          placeholder="例如：tools.read"
                        />
                      </label>
                      {server ? (
                        <small>
                          两项均留空可保留已有授权。修改任一项时请完整填写，保存后重新授权。
                        </small>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
              <label className="mcp-field">
                <span>{transport === "stdio" ? "环境变量（可选）" : "自定义请求头（可选）"}</span>
                <textarea
                  aria-label={transport === "stdio" ? "MCP 环境变量" : "MCP 请求头"}
                  rows={3}
                  spellCheck={false}
                  autoComplete="off"
                  value={values}
                  onChange={(event) => setValues(event.target.value)}
                  placeholder={transport === "stdio" ? "API_KEY=your-key" : "X-API-Key=your-key"}
                />
                <small>每行一项 KEY=value，或填写 JSON 字符串对象。值会在本机加密保存。</small>
                {server ? (
                  <small>
                    已保存：{savedValueNames?.join("、") || "无"}
                    。留空保留；填写新值会替换全部；填写 {"{}"} 清空。
                  </small>
                ) : null}
              </label>
            </>
          )}
        </fieldset>
        {validationError || save.error ? (
          <p className="inline-error" role="alert">
            {validationError ?? errorMessage(save.error, "保存失败，请检查配置和本机凭证后重试。")}
            {imported.length ? ` 已导入 ${imported.length} 个服务，重试只处理剩余服务。` : ""}
          </p>
        ) : null}
        <div className="tool-modal-actions">
          <button type="button" disabled={save.isPending} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="primary-action"
            disabled={
              save.isPending ||
              (mode === "json" && (!parsedImport.inputs.length || Boolean(parsedImport.error)))
            }
          >
            {save.isPending
              ? "正在保存…"
              : server
                ? "保存修改"
                : mode === "json"
                  ? `导入 ${parsedImport.inputs.length - imported.length} 个服务`
                  : "添加工具"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
