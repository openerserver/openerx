import {
  type DesktopMcpServerSaveInput,
  desktopMcpServerSaveInputSchema,
  mcpEnvironmentSchema,
  mcpHeadersSchema,
} from "@openerx/contracts";
import { z } from "zod";

export function parseMcpArguments(value: string): string[] {
  try {
    return z
      .array(z.string().max(8_000))
      .max(200)
      .parse(
        value.trim().startsWith("[")
          ? JSON.parse(value)
          : value.split(/\r?\n/u).filter((line) => line.trim().length > 0),
      );
  } catch {
    throw new Error("启动参数应每行填写一个参数，或填写 JSON 字符串数组。");
  }
}

export function parseMcpValues(value: string, kind: "env" | "headers"): Record<string, string> {
  const label = kind === "env" ? "环境变量" : "请求头";
  try {
    let record: unknown;
    if (value.trim().startsWith("{")) record = JSON.parse(value);
    else {
      const entries = value
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => {
          const separator = line.indexOf("=");
          if (separator <= 0) throw new Error();
          return [line.slice(0, separator).trim(), line.slice(separator + 1)] as const;
        });
      const keys = entries.map(([key]) => (kind === "headers" ? key.toLowerCase() : key));
      if (new Set(keys).size !== keys.length) throw new Error();
      record = Object.fromEntries(entries);
    }
    return (kind === "env" ? mcpEnvironmentSchema : mcpHeadersSchema).parse(record);
  } catch {
    throw new Error(`${label}应为 JSON 字符串对象或每行一项 KEY=value，名称不能重复。`);
  }
}

const importedServerSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    type: z.enum(["stdio", "http", "streamable-http", "streamable_http"]).optional(),
    transport: z.enum(["stdio", "http", "streamable-http", "streamable_http"]).optional(),
    command: z.string().trim().min(1).optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: mcpEnvironmentSchema.optional(),
    url: z.string().optional(),
    headers: mcpHeadersSchema.optional(),
    auth: z.enum(["none", "bearer", "oauth"]).optional(),
    bearerToken: z.string().optional(),
    oauthClientId: z.string().optional(),
    oauthScope: z.string().optional(),
    enabled: z.boolean().optional(),
    disabled: z.boolean().optional(),
    enabledTools: z.array(z.string()).optional(),
  })
  .strict();

export function parseMcpImport(source: string): DesktopMcpServerSaveInput[] {
  let raw: Record<string, unknown>;
  try {
    raw = z.record(z.string(), z.unknown()).parse(JSON.parse(source));
  } catch {
    throw new Error("JSON 格式不正确，请粘贴 MCP 配置对象。");
  }
  let entries: Array<[string, unknown]>;
  if ("mcpServers" in raw) {
    if (Object.keys(raw).length !== 1)
      throw new Error("请只粘贴 mcpServers 配置，不要包含其他应用设置。");
    const parsed = z.record(z.string(), z.unknown()).safeParse(raw.mcpServers);
    if (!parsed.success) throw new Error("mcpServers 应为以服务名称为键的对象。");
    entries = Object.entries(parsed.data);
  } else if ("command" in raw || "url" in raw) entries = [["MCP 服务", raw]];
  else entries = Object.entries(raw);
  if (!entries.length || entries.length > 50) throw new Error("每次可导入 1 至 50 个 MCP 服务。");
  const names = new Set<string>();
  return entries.map(([key, value]) => {
    const result = importedServerSchema.safeParse(value);
    if (!result.success)
      throw new Error(`“${key}”配置无效：请检查字段类型；目前支持 STDIO 和 Streamable HTTP。`);
    const entry = result.data;
    if (
      entry.type &&
      entry.transport &&
      (entry.type === "stdio") !== (entry.transport === "stdio")
    ) {
      throw new Error(`“${key}”的 type 与 transport 不一致。`);
    }
    if (
      entry.enabled !== undefined &&
      entry.disabled !== undefined &&
      entry.enabled === entry.disabled
    ) {
      throw new Error(`“${key}”的 enabled 与 disabled 不一致。`);
    }
    const name = entry.name ?? key.trim();
    if (!name || names.has(name.toLocaleLowerCase())) throw new Error("服务名称不能为空或重复。");
    names.add(name.toLocaleLowerCase());
    const transport = entry.transport ?? entry.type ?? (entry.command ? "stdio" : "http");
    const common = {
      id: crypto.randomUUID(),
      name,
      enabled: entry.enabled ?? !entry.disabled,
      enabledTools: entry.enabledTools ?? [],
    };
    let input: DesktopMcpServerSaveInput;
    if (transport === "stdio") {
      if (
        entry.url ||
        entry.headers ||
        entry.auth ||
        entry.bearerToken ||
        entry.oauthClientId ||
        entry.oauthScope
      ) {
        throw new Error(`“${name}”的本机进程配置不能包含 HTTP 认证或地址。`);
      }
      input = {
        config: {
          ...common,
          transport: "stdio",
          command: entry.command ?? "",
          args: entry.args ?? [],
          cwd: entry.cwd ?? "",
        },
        ...(entry.env ? { env: entry.env } : {}),
      };
    } else {
      if (entry.command || entry.args || entry.cwd || entry.env)
        throw new Error(`“${name}”的网络配置不能包含本机命令、参数或环境变量。`);
      input = {
        config: {
          ...common,
          transport: "streamable_http",
          url: entry.url ?? "",
          auth:
            entry.auth ??
            (entry.bearerToken
              ? "bearer"
              : entry.oauthClientId || entry.oauthScope
                ? "oauth"
                : "none"),
          credentialRef: null,
        },
        ...(entry.headers ? { headers: entry.headers } : {}),
        ...(entry.bearerToken ? { bearerToken: entry.bearerToken } : {}),
        ...(entry.oauthClientId ? { oauthClientId: entry.oauthClientId } : {}),
        ...(entry.oauthScope ? { oauthScope: entry.oauthScope } : {}),
      };
      if (
        input.config.transport === "streamable_http" &&
        input.config.auth === "bearer" &&
        !input.bearerToken
      )
        throw new Error(`“${name}”缺少 Bearer 令牌。`);
      if (
        input.config.transport === "streamable_http" &&
        ((entry.bearerToken && input.config.auth !== "bearer") ||
          ((entry.oauthClientId || entry.oauthScope) && input.config.auth !== "oauth"))
      )
        throw new Error(`“${name}”的认证方式与凭证字段不一致。`);
      if (
        input.config.transport === "streamable_http" &&
        input.config.auth !== "none" &&
        Object.keys(entry.headers ?? {}).some((header) => header.toLowerCase() === "authorization")
      ) {
        throw new Error(`“${name}”已选择认证方式，请移除重复的 Authorization 请求头。`);
      }
    }
    const parsed = desktopMcpServerSaveInputSchema.safeParse(input);
    if (!parsed.success)
      throw new Error(`“${name}”配置无效，请检查名称、命令、HTTP 地址和字段长度。`);
    return parsed.data;
  });
}
