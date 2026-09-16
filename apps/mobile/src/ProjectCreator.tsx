import type { RemoteCommandPayload } from "@openerx/contracts";
import * as Crypto from "expo-crypto";
import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { mobileErrorMessage } from "./presentation";

export function ProjectCreator({
  disabled,
  hostName,
  onCreate,
}: {
  disabled: boolean;
  hostName: string;
  onCreate: (payload: Extract<RemoteCommandPayload, { kind: "project.create" }>) => Promise<void>;
}) {
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const attempt = useRef<Extract<RemoteCommandPayload, { kind: "project.create" }> | null>(null);
  const close = () => {
    if (!submitting.current) setVisible(false);
  };
  const submit = async () => {
    if (disabled || submitting.current || !name.trim() || name.trim().length > 80) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    if (
      !attempt.current ||
      attempt.current.name !== name.trim() ||
      attempt.current.instructions !== instructions
    )
      attempt.current = {
        kind: "project.create",
        operationId: Crypto.randomUUID(),
        name: name.trim(),
        instructions,
      };
    try {
      await onCreate(attempt.current);
      attempt.current = null;
      setName("");
      setInstructions("");
      setVisible(false);
    } catch (caught) {
      setError(mobileErrorMessage(caught));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <React.Fragment>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="新建项目"
        disabled={disabled}
        onPress={() => setVisible(true)}
        style={[styles.button, disabled && styles.disabled]}
      >
        <Text style={styles.buttonText}>新建项目</Text>
      </Pressable>
      <Modal visible={visible} animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.page}
        >
          <SafeAreaView style={styles.page}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              <Text accessibilityRole="header" style={styles.title}>
                新建项目
              </Text>
              <Text style={styles.hint}>
                项目将创建在{hostName}上。文件目录可稍后在电脑端添加。
              </Text>
              <TextInput
                accessibilityLabel="项目名称"
                placeholder="项目名称"
                placeholderTextColor="#929c92"
                value={name}
                onChangeText={setName}
                maxLength={80}
                editable={!busy}
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="项目说明（选填）"
                placeholder="项目说明（选填）"
                placeholderTextColor="#929c92"
                value={instructions}
                onChangeText={setInstructions}
                maxLength={20000}
                editable={!busy}
                multiline
                style={[styles.input, styles.instructions]}
              />
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="取消"
                  disabled={busy}
                  onPress={close}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>取消</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="创建项目"
                  disabled={disabled || busy || !name.trim()}
                  onPress={() => void submit()}
                  style={[styles.button, (disabled || busy || !name.trim()) && styles.disabled]}
                >
                  <Text style={styles.buttonText}>{busy ? "正在创建…" : "创建项目"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </React.Fragment>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#111411" },
  content: { padding: 24, gap: 16 },
  title: { color: "#eef2eb", fontSize: 24, fontWeight: "700" },
  hint: { color: "#929c92", fontSize: 14, lineHeight: 21 },
  input: {
    backgroundColor: "#191d19",
    borderColor: "#363e34",
    borderWidth: 1,
    borderRadius: 12,
    color: "#eef2eb",
    padding: 14,
    fontSize: 16,
  },
  instructions: { minHeight: 120, maxHeight: 200, textAlignVertical: "top" },
  actions: { flexDirection: "row", gap: 12 },
  button: {
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#263522",
  },
  buttonText: { color: "#b7f397", fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  error: { color: "#f3a599", lineHeight: 21 },
});
