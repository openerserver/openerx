import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { type MobileTask, taskStatusLabel } from "./presentation";

export function HistoryPanel({
  tasks,
  selectedId,
  syncing,
  syncedAt,
  error,
  onRefresh,
  onOpen,
}: {
  tasks: MobileTask[];
  selectedId: string | null;
  syncing: boolean;
  syncedAt: string | null;
  error: string | null;
  onRefresh: () => void;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [limit, setLimit] = useState(30);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = tasks.filter(
    (task) =>
      (archived || !task.archivedAt) &&
      (!needle ||
        task.title.toLocaleLowerCase().includes(needle) ||
        task.messages.some((message) => message.text.toLocaleLowerCase().includes(needle))),
  );
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>全部任务 · {filtered.length}</Text>
        <Pressable accessibilityRole="button" disabled={syncing} onPress={onRefresh}>
          <Text style={styles.action}>{syncing ? "同步中…" : "刷新历史"}</Text>
        </Pressable>
      </View>
      <Text style={styles.meta}>
        {error ??
          (syncedAt
            ? `账户历史已同步 · ${new Date(syncedAt).toLocaleString()}`
            : "正在获取账户历史…")}
      </Text>
      <TextInput
        accessibilityLabel="搜索历史任务"
        placeholder="搜索标题或消息内容"
        placeholderTextColor="#929c92"
        style={styles.input}
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setLimit(30);
        }}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: archived }}
        onPress={() => {
          setArchived((value) => !value);
          setLimit(30);
        }}
      >
        <Text style={styles.action}>{archived ? "☑" : "☐"} 包含已归档任务</Text>
      </Pressable>
      {filtered.slice(0, limit).map((task) => (
        <Pressable
          key={task.id}
          accessibilityRole="button"
          accessibilityState={{ selected: selectedId === task.id }}
          style={styles.item}
          onPress={() => onOpen(task.id)}
        >
          <Text numberOfLines={2} style={styles.title}>
            {task.title}
          </Text>
          <Text numberOfLines={2} style={styles.meta}>
            {task.messages.at(-1)?.text}
          </Text>
          <Text style={styles.meta}>
            {task.archivedAt ? "已归档 · " : ""}
            {taskStatusLabel(task.status)} · {new Date(task.updatedAt).toLocaleString()}
          </Text>
        </Pressable>
      ))}
      {!filtered.length ? (
        <Text style={styles.meta}>{needle ? "没有匹配的任务。" : "暂无已同步的任务。"}</Text>
      ) : null}
      {filtered.length > limit ? (
        <Pressable accessibilityRole="button" onPress={() => setLimit((value) => value + 30)}>
          <Text style={styles.action}>加载更多任务</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 16, gap: 14, backgroundColor: "#1b211b", borderRadius: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  title: { color: "#e9eee7", fontSize: 15, fontWeight: "600" },
  meta: { color: "#a5afa2", fontSize: 12, lineHeight: 19 },
  action: { color: "#b7f397", paddingVertical: 8, fontSize: 14 },
  item: { gap: 6, borderTopColor: "#343c32", borderTopWidth: 1, paddingVertical: 12 },
  input: { color: "#e9eee7", backgroundColor: "#111411", borderRadius: 10, padding: 12 },
});
