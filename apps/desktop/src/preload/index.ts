import {
  type ChatCommandEnvelope,
  type ChatCommandResultMap,
  chatActivateBranchInputSchema,
  chatArchiveInputSchema,
  chatDeleteInputSchema,
  chatEditInputSchema,
  chatEventSchema,
  chatEventsInputSchema,
  chatGetInputSchema,
  chatListInputSchema,
  chatRegenerateInputSchema,
  chatRenameInputSchema,
  chatSearchInputSchema,
  chatSendInputSchema,
  chatStopInputSchema,
  type DesktopBridge,
  desktopEnvironmentSchema,
  ipcChannels,
  parseChatCommandResult,
} from "@openerx/contracts";
import { contextBridge, ipcRenderer } from "electron";

async function invokeChat<C extends keyof ChatCommandResultMap>(
  channel: string,
  command: C & ChatCommandEnvelope["command"],
  input: unknown,
): Promise<ChatCommandResultMap[C]> {
  const result: unknown = await ipcRenderer.invoke(channel, input);
  return parseChatCommandResult(command, result);
}

const bridge: DesktopBridge = {
  getEnvironment: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.environmentGet);
    return desktopEnvironmentSchema.parse(result);
  },
  listConversations: async (input = {}) =>
    invokeChat(ipcChannels.chatList, "chat.list", chatListInputSchema.parse(input)),
  getConversation: async (input) =>
    invokeChat(ipcChannels.chatGet, "chat.get", chatGetInputSchema.parse(input)),
  sendMessage: async (input) =>
    invokeChat(ipcChannels.chatSend, "chat.send", chatSendInputSchema.parse(input)),
  stopGeneration: async (input) =>
    invokeChat(ipcChannels.chatStop, "chat.stop", chatStopInputSchema.parse(input)),
  regenerateMessage: async (input) =>
    invokeChat(
      ipcChannels.chatRegenerate,
      "chat.regenerate",
      chatRegenerateInputSchema.parse(input),
    ),
  editMessage: async (input) =>
    invokeChat(ipcChannels.chatEdit, "chat.edit", chatEditInputSchema.parse(input)),
  renameConversation: async (input) =>
    invokeChat(ipcChannels.chatRename, "chat.rename", chatRenameInputSchema.parse(input)),
  setConversationArchived: async (input) =>
    invokeChat(ipcChannels.chatArchive, "chat.archive", chatArchiveInputSchema.parse(input)),
  deleteConversation: async (input) =>
    invokeChat(ipcChannels.chatDelete, "chat.delete", chatDeleteInputSchema.parse(input)),
  search: async (input) =>
    invokeChat(ipcChannels.chatSearch, "chat.search", chatSearchInputSchema.parse(input)),
  activateBranch: async (input) =>
    invokeChat(
      ipcChannels.chatActivateBranch,
      "chat.activateBranch",
      chatActivateBranchInputSchema.parse(input),
    ),
  getChatEvents: async (input) =>
    invokeChat(ipcChannels.chatEvents, "chat.events", chatEventsInputSchema.parse(input)),
  onChatEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = chatEventSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(ipcChannels.chatEvent, wrapped);
    return () => {
      ipcRenderer.removeListener(ipcChannels.chatEvent, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("openerx", Object.freeze(bridge));
