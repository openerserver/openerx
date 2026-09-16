import {
  type RemoteCommandPayload,
  type RemoteConnectionRequest,
  type RemoteDevicePairing,
  type RemoteHost,
  type RemoteProjectSummary,
  remoteProjectSnapshotPayloadSchema,
} from "@openerx/contracts";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  MobileAttachmentUploader,
  type PendingAttachment,
  type UploadStatus,
  validateAttachmentBatch,
} from "./src/attachments";
import { ComposerInput } from "./src/ComposerInput";
import { emptyHistory, historyTasks, MobileHistorySync } from "./src/history";
import { HistoryPanel } from "./src/history-panel";
import { MobileApi } from "./src/mobile-api";
import { attachmentChecksum, pickAttachments, readAttachment } from "./src/native-attachments";
import { nativeHistoryStorage } from "./src/native-history-storage";
import {
  hostPresenceLabel,
  isRemoteHostReachable,
  type MobileTask,
  mergeRemoteEvents,
  mobileErrorMessage,
  pendingAttention,
  taskConnectionLabel,
} from "./src/presentation";
import { type DecryptedRemoteEvent, RemoteController } from "./src/remote-controller";
import {
  clearSession,
  loadSession,
  type MobileSession,
  mobileDevice,
  refreshSession,
  saveSession,
} from "./src/session";
import { maintainMobileSession } from "./src/session-refresh";

type Tab = "hosts" | "tasks" | "inbox" | "settings";

const baseUrl = process.env.EXPO_PUBLIC_OPENERX_PLATFORM_URL?.replace(/\/$/u, "") ?? "";

function PrimaryButton({
  label,
  onPress,
  disabled = false,
  tone = "accent",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "accent" | "neutral" | "danger";
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "accent" ? styles.buttonAccent : null,
        tone === "danger" ? styles.buttonDanger : null,
        pressed ? styles.buttonPressed : null,
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Text style={tone === "accent" ? styles.buttonAccentText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Login({
  api,
  onSignedIn,
}: {
  api: MobileApi;
  onSignedIn: (value: MobileSession) => void;
}) {
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!challengeId) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [challengeId]);
  const sendCode = async (): Promise<void> => {
    const challenge = await api.requestCode(email.trim());
    setChallengeId(challenge.challengeId);
    setCode("");
    setResendAt(Date.now() + 60_000);
    setNow(Date.now());
  };
  const submit = async (resend = false): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!challengeId || resend) await sendCode();
      else
        onSignedIn(
          await saveSession(await api.verifyCode(challengeId, code, await mobileDevice())),
        );
    } catch (caught) {
      setError(mobileErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1_000));
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.app}
    >
      <SafeAreaView style={styles.flex}>
        <StatusBar style="light" />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.loginContent}>
          <View style={styles.loginMark}>
            <Text style={styles.loginMarkText}>O</Text>
          </View>
          <Text style={styles.eyebrow}>openerx</Text>
          <Text style={styles.loginTitle}>从手机继续任务</Text>
          <Text style={styles.loginCopy}>
            与电脑登录同一账户。查看进度、补充要求，让电脑继续处理。
          </Text>
          {!baseUrl ? <Text style={styles.error}>服务地址未配置，请联系应用提供方。</Text> : null}
          <View style={styles.loginCard}>
            <Text style={styles.fieldLabel}>账户邮箱</Text>
            <TextInput
              accessibilityLabel="账户邮箱"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!challengeId && !busy}
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#929c92"
              style={styles.input}
              value={email}
            />
            {challengeId ? (
              <>
                <Text style={styles.cardMeta}>验证码已发送，请检查邮箱和垃圾邮件。</Text>
                <Text style={styles.fieldLabel}>六位验证码</Text>
                <TextInput
                  accessibilityLabel="六位验证码"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!busy}
                  onChangeText={(value) => setCode(value.replace(/\D/gu, ""))}
                  placeholder="输入验证码"
                  placeholderTextColor="#929c92"
                  style={styles.input}
                  value={code}
                />
              </>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <PrimaryButton
              disabled={
                busy ||
                !baseUrl ||
                (!challengeId
                  ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())
                  : !/^\d{6}$/u.test(code))
              }
              label={busy ? "请稍候…" : challengeId ? "验证并登录" : "发送验证码"}
              onPress={() => void submit()}
            />
            {challengeId ? (
              <View style={styles.chipRow}>
                <PrimaryButton
                  label="更换邮箱"
                  tone="neutral"
                  disabled={busy}
                  onPress={() => {
                    setChallengeId(null);
                    setCode("");
                    setError(null);
                    setResendAt(0);
                  }}
                />
                <PrimaryButton
                  label={remaining > 0 ? `${remaining} 秒后重发` : "重新发送"}
                  tone="neutral"
                  disabled={busy || remaining > 0}
                  onPress={() => void submit(true)}
                />
              </View>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function HostCard({
  host,
  selected,
  paired,
  onPress,
  request,
  busy,
  onConnect,
}: {
  host: RemoteHost;
  selected: boolean;
  paired: boolean;
  onPress: () => void;
  request: RemoteConnectionRequest | undefined;
  busy: boolean;
  onConnect: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.card, selected ? styles.cardSelected : null]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`选择 ${host.displayName}`}
      >
        <View style={styles.hostHeader}>
          <View style={styles.hostIcon}>
            <Text style={styles.hostIconText}>⌘</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{host.displayName}</Text>
            <Text style={styles.cardMeta}>
              {host.platform === "darwin" ? "Mac" : host.platform === "win32" ? "Windows" : "Linux"}{" "}
              · {host.appVersion}
            </Text>
          </View>
          <View
            style={[
              styles.statusDot,
              host.presence === "online" ? styles.statusOnline : null,
              host.presence === "degraded" ? styles.statusDegraded : null,
            ]}
          />
        </View>
        <View style={styles.chipRow}>
          <Text style={styles.chip}>{hostPresenceLabel(host)}</Text>
          <Text style={styles.chip}>
            {paired
              ? host.presence === "online"
                ? "已连接"
                : "已授权"
              : request?.status === "pending"
                ? "等待电脑确认"
                : "尚未授权"}
          </Text>
        </View>
      </Pressable>
      {!paired && request?.status === "rejected" ? (
        <Text style={styles.cardMeta}>电脑已拒绝此次申请，可重新申请。</Text>
      ) : null}
      {!paired && request?.status === "expired" ? (
        <Text style={styles.cardMeta}>申请已过期或电脑已关闭远程连接，请重新申请。</Text>
      ) : null}
      <PrimaryButton
        label={
          busy
            ? "正在申请…"
            : !host.remoteEnabled
              ? "电脑未开启远程连接"
              : !isRemoteHostReachable(host)
                ? "电脑离线"
                : paired
                  ? "进入任务"
                  : request?.status === "pending"
                    ? "等待电脑确认"
                    : request
                      ? "重新申请连接"
                      : "申请连接"
        }
        disabled={
          busy ||
          !host.remoteEnabled ||
          !isRemoteHostReachable(host) ||
          (!paired && request?.status === "pending")
        }
        onPress={onConnect}
      />
    </View>
  );
}

function HostsScreen({
  hosts,
  pairings,
  selectedHostId,
  onSelect,
  onRefresh,
  onPair,
  onRevoke,
  requests,
  requestingHostId,
  onConnect,
}: {
  hosts: RemoteHost[];
  pairings: RemoteDevicePairing[];
  selectedHostId: string | null;
  onSelect: (host: RemoteHost) => void;
  onRefresh: () => void;
  onPair: (value: string) => Promise<void>;
  onRevoke: (pairing: RemoteDevicePairing) => Promise<void>;
  requests: RemoteConnectionRequest[];
  requestingHostId: string | null;
  onConnect: (host: RemoteHost) => Promise<void>;
}): React.JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [showQrOptions, setShowQrOptions] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const scan = async (value: string): Promise<void> => {
    setScanning(false);
    await onPair(value);
  };
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.eyebrow}>已登录的电脑</Text>
          <Text style={styles.pageTitle}>电脑</Text>
        </View>
        <PrimaryButton label="刷新" onPress={onRefresh} tone="neutral" />
      </View>
      <Text style={styles.pageCopy}>
        同账户的电脑会自动出现。首次申请连接需在电脑上允许，之后自动连接已授权电脑。
      </Text>
      {hosts.map((host) => (
        <HostCard
          host={host}
          key={host.hostDeviceId}
          onPress={() => onSelect(host)}
          paired={pairings.some(
            (pairing) => pairing.hostDeviceId === host.hostDeviceId && pairing.status === "active",
          )}
          selected={host.hostDeviceId === selectedHostId}
          request={requests.find((request) => request.hostDeviceId === host.hostDeviceId)}
          busy={requestingHostId === host.hostDeviceId}
          onConnect={() => void onConnect(host)}
        />
      ))}
      {hosts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>还没有可连接的电脑</Text>
          <Text style={styles.cardMeta}>在电脑登录同一账户，并打开“设置 → 手机远程控制”。</Text>
        </View>
      ) : null}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>也可使用二维码配对</Text>
        <PrimaryButton
          label={showQrOptions ? "收起" : "扫码配对"}
          tone="neutral"
          onPress={() => {
            setShowQrOptions((value) => !value);
            setScanning(false);
          }}
        />
      </View>
      {showQrOptions ? (
        <>
          {scanning && permission?.granted ? (
            <View style={styles.cameraFrame}>
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => void scan(data)}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.scanGuide} />
            </View>
          ) : (
            <PrimaryButton
              label="扫描桌面配对码"
              onPress={() =>
                void (async () => {
                  const result = permission?.granted ? permission : await requestPermission();
                  if (result.granted) setScanning(true);
                  else
                    Alert.alert("相机权限未开启", "可以粘贴配对链接，或前往系统设置允许相机。", [
                      { text: "取消", style: "cancel" },
                      { text: "打开设置", onPress: () => void Linking.openSettings() },
                    ]);
                })()
              }
            />
          )}
          <TextInput
            autoCapitalize="none"
            onChangeText={setManualValue}
            placeholder="粘贴配对链接（可选）"
            placeholderTextColor="#6d746d"
            style={styles.input}
            value={manualValue}
          />
          <PrimaryButton
            disabled={!manualValue}
            label="使用链接配对"
            onPress={() => void scan(manualValue)}
            tone="neutral"
          />
        </>
      ) : null}
      {pairings
        .filter(({ status }) => status === "active")
        .map((pairing) => (
          <View key={pairing.pairingId} style={styles.pairingRow}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>
                {hosts.find((host) => host.hostDeviceId === pairing.hostDeviceId)?.displayName ??
                  "已授权电脑"}
              </Text>
              <Text style={styles.cardMeta}>
                到期 {new Date(pairing.expiresAt).toLocaleDateString()}
              </Text>
            </View>
            <PrimaryButton label="撤销" onPress={() => void onRevoke(pairing)} tone="danger" />
          </View>
        ))}
    </ScrollView>
  );
}

function TasksScreen({
  host,
  pairing,
  projects,
  selectedProjectId,
  conversationId,
  tasks,
  keyboardVisible,
  onCommand,
  onNewTask,
  onRefreshProjects,
  onSelectProject,
  onOpenTask,
  uploader,
  historySyncing,
  historySyncedAt,
  historyError,
  onRefreshHistory,
  onSelectBranch,
}: {
  host: RemoteHost | null;
  pairing: RemoteDevicePairing | null;
  projects: RemoteProjectSummary[];
  selectedProjectId: string | null;
  conversationId: string | null;
  tasks: MobileTask[];
  keyboardVisible: boolean;
  onCommand: (payload: RemoteCommandPayload) => Promise<void>;
  onNewTask: () => void;
  onRefreshProjects: () => Promise<void>;
  onSelectProject: (id: string | null) => void;
  onOpenTask: (id: string) => void;
  uploader: MobileAttachmentUploader;
  historySyncing: boolean;
  historySyncedAt: string | null;
  historyError: string | null;
  onRefreshHistory: () => void;
  onSelectBranch: (conversationId: string, branchId: string) => void;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<
    Record<string, { text: string; files: PendingAttachment[] }>
  >({});
  const draftKey = conversationId ?? "new";
  const { text, files } = drafts[draftKey] ?? { text: "", files: [] };
  const setText = (value: string) =>
    setDrafts((current) => ({
      ...current,
      [draftKey]: { text: value, files: current[draftKey]?.files ?? [] },
    }));
  const setFiles = (value: PendingAttachment[]) =>
    setDrafts((current) => ({
      ...current,
      [draftKey]: { files: value, text: current[draftKey]?.text ?? "" },
    }));
  const [uploads, setUploads] = useState<Record<string, UploadStatus>>({});
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [messageLimit, setMessageLimit] = useState(100);
  const previousConversation = useRef(conversationId);
  const [busy, setBusy] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const task = tasks.find((value) => value.id === conversationId);
  const historicalBranch = Boolean(
    task?.viewingBranchId && task.viewingBranchId !== task.activeBranchId,
  );
  const activeMessageId = task?.activeMessageId ?? null;
  const running = Boolean(activeMessageId);
  const selectedProject = projects.find((project) => project.projectId === selectedProjectId);
  const canControl = Boolean(
    isRemoteHostReachable(host) && pairing && !historicalBranch && !task?.archivedAt,
  );
  useEffect(() => {
    if (previousConversation.current !== conversationId) {
      previousConversation.current = conversationId;
      setMessageLimit(100);
      setAttachmentError(null);
    }
  }, [conversationId]);
  const choose = async (source: "files" | "photos" | "camera") => {
    if (busy || picking || running) return;
    setPicking(true);
    setAttachmentError(null);
    setShowAttachmentPicker(false);
    try {
      const selected = await pickAttachments(source);
      validateAttachmentBatch([...files, ...selected]);
      setFiles([...files, ...selected]);
    } catch (error) {
      setAttachmentError(mobileErrorMessage(error));
    } finally {
      setPicking(false);
    }
  };
  const invoke = async (payload: RemoteCommandPayload): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setAttachmentError(null);
    try {
      if ((payload.kind === "task.start" || payload.kind === "session.prompt") && files.length) {
        if (!host?.capabilities.includes("attachment.upload"))
          throw new Error("REMOTE_ATTACHMENT_UNSUPPORTED");
        const attachments = await uploader.upload(files, (id, status) =>
          setUploads((current) => ({ ...current, [id]: status })),
        );
        payload = { ...payload, attachments };
      }
      await onCommand(payload);
      if (payload.kind !== "session.abort") setText("");
      if (payload.kind === "task.start" || payload.kind === "session.prompt") {
        uploader.forget(files);
        setFiles([]);
      }
    } catch (error) {
      setAttachmentError(mobileErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const send = (): void => {
    const prompt = text.trim();
    if (!prompt || !canControl || busy || picking || (running && files.length > 0)) return;
    void invoke(
      running
        ? { kind: "session.steer", text: prompt }
        : conversationId
          ? {
              kind: "session.prompt",
              text: prompt,
              clientOperationId: Crypto.randomUUID(),
              executionMode: "attended",
            }
          : {
              kind: "task.start",
              text: prompt,
              clientOperationId: Crypto.randomUUID(),
              executionMode: "unattended",
              projectId: selectedProjectId,
            },
    );
  };
  return (
    <View style={styles.flex}>
      <View style={styles.taskHeader}>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.sectionTitle}>
            {host?.displayName ?? "请先连接电脑"}
          </Text>
          <Text style={styles.cardMeta}>{taskConnectionLabel(host, Boolean(pairing), task)}</Text>
        </View>
        {!keyboardVisible ? (
          <PrimaryButton
            label="历史任务"
            tone="neutral"
            onPress={() => {
              nearBottom.current = false;
              setShowHistory((value) => !value);
              scroll.current?.scrollTo({ y: 0, animated: true });
            }}
          />
        ) : null}
        <PrimaryButton
          label="新任务"
          tone="neutral"
          disabled={busy}
          onPress={() => {
            onNewTask();
            setShowHistory(false);
          }}
        />
      </View>
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.taskContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        scrollEventThrottle={80}
        onScroll={({ nativeEvent }) => {
          nearBottom.current =
            nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >=
            nativeEvent.contentSize.height - 80;
        }}
        onContentSizeChange={() => {
          if (showHistory) scroll.current?.scrollTo({ y: 0, animated: true });
          else if (nearBottom.current && conversationId)
            scroll.current?.scrollToEnd({ animated: true });
        }}
      >
        {showHistory ? (
          <HistoryPanel
            tasks={tasks}
            selectedId={conversationId}
            syncing={historySyncing}
            syncedAt={historySyncedAt}
            error={historyError}
            onRefresh={onRefreshHistory}
            onOpen={(id) => {
              if (!busy && !picking) {
                onOpenTask(id);
                setShowHistory(false);
              }
            }}
          />
        ) : null}
        {showHistory ? null : !conversationId ? (
          <>
            <View style={styles.emptyTask}>
              <Text style={styles.pageTitle}>想让电脑做什么？</Text>
              <Text style={styles.pageCopy}>
                描述目标，电脑会继续处理。你可以在这里查看结果或补充要求。
              </Text>
            </View>
            {!keyboardVisible ? (
              <View style={styles.card}>
                <View style={styles.sectionHeader}>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>{selectedProject?.name ?? "不指定项目"}</Text>
                    <Text style={styles.cardMeta}>使用电脑已授权的文件目录</Text>
                  </View>
                  <PrimaryButton
                    label={showProjects ? "收起" : "选择项目"}
                    tone="neutral"
                    onPress={() => setShowProjects((value) => !value)}
                  />
                </View>
                {showProjects ? (
                  <>
                    <PrimaryButton
                      label="不指定项目"
                      tone={selectedProjectId === null ? "accent" : "neutral"}
                      onPress={() => onSelectProject(null)}
                    />
                    {projects.map((project) => (
                      <PrimaryButton
                        key={project.projectId}
                        label={project.name}
                        tone={project.projectId === selectedProjectId ? "accent" : "neutral"}
                        onPress={() => onSelectProject(project.projectId)}
                      />
                    ))}
                    <PrimaryButton
                      label="刷新项目"
                      tone="neutral"
                      disabled={!canControl}
                      onPress={() => void onRefreshProjects().catch(() => undefined)}
                    />
                  </>
                ) : null}
                {selectedProject ? (
                  <>
                    {selectedProject.instructions ? (
                      <Text style={styles.cardMeta}>{selectedProject.instructions}</Text>
                    ) : null}
                    {selectedProject.directories.map((directory) => (
                      <Text key={directory.projectDirectoryId} style={styles.cardMeta}>
                        {directory.displayName} ·{" "}
                        {directory.connectionState === "connected" ? "已连接" : "需在电脑重新连接"}
                      </Text>
                    ))}
                  </>
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{task?.title ?? "正在获取任务…"}</Text>
            {(task?.branches?.length ?? 0) > 1 ? (
              <View style={styles.card}>
                <Text style={styles.cardMeta}>对话分支</Text>
                {task?.branches?.map((branch) => (
                  <PrimaryButton
                    key={branch.id}
                    label={`${branch.label}${branch.id === task.activeBranchId ? " · 当前" : ""}`}
                    tone={branch.id === task.viewingBranchId ? "accent" : "neutral"}
                    disabled={busy}
                    onPress={() => onSelectBranch(task.id, branch.id)}
                  />
                ))}
              </View>
            ) : null}
            {historicalBranch ? (
              <Text style={styles.pageCopy}>正在查看历史分支，切回当前分支后可继续任务。</Text>
            ) : null}
            {task?.archivedAt ? (
              <Text style={styles.pageCopy}>此任务已归档，可在电脑上恢复后继续。</Text>
            ) : null}
            {(task?.messages.length ?? 0) > messageLimit ? (
              <PrimaryButton
                label="加载更早的消息"
                tone="neutral"
                onPress={() => setMessageLimit((value) => value + 100)}
              />
            ) : null}
            {task?.attachments
              ?.filter((attachment) => !attachment.messageId)
              .map((attachment) => (
                <Text key={attachment.id} style={styles.cardMeta}>
                  附件 · {attachment.displayName}
                </Text>
              ))}
            {task?.messages.slice(-messageLimit).map((message) => (
              <View
                key={message.id}
                style={[styles.messageBubble, message.role === "user" ? styles.userBubble : null]}
              >
                <Text style={styles.messageAuthor}>
                  {message.role === "user" ? "你" : "openerx"}
                </Text>
                {message.text ? (
                  <Text selectable style={styles.messageText}>
                    {message.text}
                  </Text>
                ) : message.status === "running" ? (
                  <Text style={styles.cardMeta}>正在处理…</Text>
                ) : null}
                {message.status === "failed" ? (
                  <Text style={styles.error}>{mobileErrorMessage(message.reason)}</Text>
                ) : null}
                {task.attachments
                  ?.filter((attachment) => attachment.messageId === message.id)
                  .map((attachment) => (
                    <Text key={attachment.id} style={styles.cardMeta}>
                      附件 · {attachment.displayName} · {Math.ceil(attachment.sizeBytes / 1024)} KB
                    </Text>
                  ))}
                {message.status === "stopped" ? (
                  <Text style={styles.cardMeta}>已停止，可以继续发送要求。</Text>
                ) : null}
              </View>
            ))}
            {task?.status === "waiting" ? (
              <Text style={styles.pageCopy}>有一项操作需要你确认，请前往收件箱处理。</Text>
            ) : null}
          </>
        )}
      </ScrollView>
      {!showHistory ? (
        <View style={styles.composer}>
          {files.map((file) => (
            <View key={file.id} style={styles.sectionHeader}>
              <Text numberOfLines={1} style={[styles.cardMeta, styles.flex]}>
                {file.displayName} · {Math.ceil(file.sizeBytes / 1024)} KB ·{" "}
                {
                  {
                    pending: "待发送",
                    reading: "读取中",
                    uploading: "上传中",
                    uploaded: "已上传",
                    failed: "上传失败，可重试",
                  }[uploads[file.id] ?? "pending"]
                }
              </Text>
              <PrimaryButton
                label="移除"
                tone="neutral"
                disabled={busy || picking}
                onPress={() => {
                  uploader.forget([file]);
                  setFiles(files.filter((item) => item.id !== file.id));
                }}
              />
            </View>
          ))}
          {attachmentError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {attachmentError}
            </Text>
          ) : null}
          <PrimaryButton
            label={picking ? "正在选择…" : "添加附件"}
            tone="neutral"
            disabled={busy || picking || running || historicalBranch || Boolean(task?.archivedAt)}
            onPress={() => setShowAttachmentPicker((value) => !value)}
          />
          {showAttachmentPicker ? (
            <View style={styles.composerActions}>
              <PrimaryButton label="选择文件" tone="neutral" onPress={() => void choose("files")} />
              <PrimaryButton
                label="选择照片"
                tone="neutral"
                onPress={() => void choose("photos")}
              />
              <PrimaryButton label="拍照" tone="neutral" onPress={() => void choose("camera")} />
            </View>
          ) : null}
          <ComposerInput
            key={draftKey}
            accessibilityLabel="任务输入"
            editable={!busy}
            value={text}
            onChangeText={setText}
            placeholder={
              running ? "补充当前任务的要求…" : conversationId ? "继续提问或说明…" : "描述任务目标…"
            }
            placeholderTextColor="#929c92"
            style={styles.input}
          />
          <View style={styles.composerActions}>
            <View style={styles.flex}>
              <PrimaryButton
                label={
                  busy
                    ? "等待电脑确认…"
                    : running
                      ? "补充要求"
                      : conversationId
                        ? "发送"
                        : "开始任务"
                }
                disabled={
                  busy || picking || !canControl || !text.trim() || (running && files.length > 0)
                }
                onPress={send}
              />
            </View>
            {running ? (
              <>
                <PrimaryButton
                  label="排队发送"
                  tone="neutral"
                  disabled={busy || picking || !canControl || !text.trim() || files.length > 0}
                  onPress={() => void invoke({ kind: "session.follow_up", text: text.trim() })}
                />
                <PrimaryButton
                  label="停止"
                  tone="danger"
                  disabled={busy || !canControl}
                  onPress={() =>
                    void invoke({
                      kind: "session.abort",
                      assistantMessageId: activeMessageId as string,
                    })
                  }
                />
              </>
            ) : null}
          </View>
          {!keyboardVisible ? (
            <Text style={styles.sectionHint}>
              {running
                ? "当前回复结束后可添加附件。"
                : "附件会随任务发送到电脑；支持文档、图片，合计不超过 50 MB。"}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function InboxScreen({
  events,
  tasks,
  onDecision,
  onOpenTask,
}: {
  events: DecryptedRemoteEvent[];
  tasks: MobileTask[];
  onDecision: (
    event: DecryptedRemoteEvent,
    decision: "once" | "session" | "full_access" | "deny",
  ) => Promise<void>;
  onOpenTask: (id: string) => void;
}): React.JSX.Element {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [handled, setHandled] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const pending = pendingAttention(events, now).filter(
    ({ envelope }) => !handled.includes(envelope.eventId),
  );
  const attention = [
    ...pending.reverse(),
    ...events
      .filter(({ envelope }) =>
        [
          "review.available",
          "message.completed",
          "message.failed",
          "message.stopped",
          "message.interrupted",
        ].includes(envelope.kind),
      )
      .reverse(),
  ];
  const decide = async (
    item: DecryptedRemoteEvent,
    decision: "once" | "session" | "full_access" | "deny",
  ) => {
    if (busyId) return;
    setBusyId(item.envelope.eventId);
    try {
      await onDecision(item, decision);
      setHandled((current) => [...current, item.envelope.eventId]);
    } catch (error) {
      Alert.alert("审批未提交", mobileErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };
  return (
    <FlatList
      contentContainerStyle={styles.screenContent}
      data={attention}
      keyExtractor={({ envelope }) => envelope.eventId}
      ListHeaderComponent={
        <>
          <Text style={styles.pageTitle}>收件箱</Text>
          <Text style={styles.pageCopy}>任务结果和需要你确认的操作会出现在这里。</Text>
        </>
      }
      ListEmptyComponent={
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>没有待处理事项</Text>
          <Text style={styles.cardMeta}>电脑有新进展时，会在这里提醒你。</Text>
        </View>
      }
      renderItem={({ item }) => {
        const permission = item.envelope.kind === "attention.requested";
        const task = tasks.find((value) => value.id === item.envelope.conversationId);
        const resultMessage = task?.messages.find(
          (message) => message.id === item.payload.messageId,
        );
        const stopped =
          item.envelope.kind === "message.stopped" || resultMessage?.status === "stopped";
        const failed =
          item.envelope.kind === "message.failed" ||
          (item.envelope.kind === "message.interrupted" && !stopped);
        const label = permission
          ? "等待你确认"
          : failed
            ? "任务未完成"
            : stopped
              ? "任务已停止"
              : item.envelope.kind === "review.available"
                ? "请在电脑检查结果"
                : "任务已完成";
        return (
          <View style={styles.card}>
            <Text style={styles.messageAuthor}>{label}</Text>
            <Text style={styles.cardTitle}>{task?.title ?? "电脑任务"}</Text>
            <Text style={styles.cardMeta}>
              {permission
                ? String(
                    item.payload.permissionReason ?? "电脑请求执行一项操作，请核对后决定是否允许。",
                  )
                : failed
                  ? mobileErrorMessage(item.payload.reason ?? resultMessage?.reason)
                  : new Date(item.envelope.occurredAt).toLocaleString()}
            </Text>
            {permission ? (
              <>
                <Text style={styles.cardMeta}>
                  “本会话允许”记住相同范围的操作；“完全允许”在当前会话中不再逐次询问。
                </Text>
                <View style={styles.chipRow}>
                  <PrimaryButton
                    label={busyId === item.envelope.eventId ? "正在提交…" : "本次允许"}
                    disabled={Boolean(busyId)}
                    onPress={() => void decide(item, "once")}
                  />
                  {["L0", "L1", "L2", "L3"].includes(String(item.payload.risk)) ? (
                    <PrimaryButton
                      label="本会话允许"
                      disabled={Boolean(busyId)}
                      tone="neutral"
                      onPress={() => void decide(item, "session")}
                    />
                  ) : null}
                  <PrimaryButton
                    label="完全允许"
                    disabled={Boolean(busyId)}
                    tone="neutral"
                    onPress={() =>
                      Alert.alert(
                        "完全允许当前会话",
                        "允许当前待审批操作，并在此会话中不再逐次询问。可在电脑输入框恢复请求审批。",
                        [
                          { text: "取消", style: "cancel" },
                          { text: "完全允许", onPress: () => void decide(item, "full_access") },
                        ],
                      )
                    }
                  />
                  <PrimaryButton
                    label="拒绝"
                    disabled={Boolean(busyId)}
                    tone="danger"
                    onPress={() => void decide(item, "deny")}
                  />
                </View>
              </>
            ) : null}
            {item.envelope.conversationId ? (
              <PrimaryButton
                label="查看任务"
                tone="neutral"
                onPress={() => onOpenTask(item.envelope.conversationId as string)}
              />
            ) : null}
          </View>
        );
      }}
    />
  );
}

function SettingsScreen({
  api,
  session,
  onSignOut,
}: {
  api: MobileApi;
  session: MobileSession;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const [permission, setPermission] = useState<Notifications.NotificationPermissionsStatus | null>(
    null,
  );
  const [registration, setRegistration] = useState<"unknown" | "ready" | "failed">("unknown");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void Notifications.getPermissionsAsync()
        .then((value) => {
          if (active) setPermission(value);
        })
        .catch(() => undefined);
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const requestNotifications = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (permission && !permission.granted && !permission.canAskAgain) {
        await Linking.openSettings();
        return;
      }
      const result = await Notifications.requestPermissionsAsync();
      setPermission(result);
      if (!result.granted) return;
      const [token, device] = await Promise.all([
        Notifications.getDevicePushTokenAsync(),
        mobileDevice(),
      ]);
      const pushTokenRef = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(token.data),
      );
      await api.upsertPushSubscription(session.accessToken, {
        version: 1,
        subscriptionId: Crypto.randomUUID(),
        accountId: session.account.accountId,
        deviceId: device.deviceId,
        platform: device.platform === "ios" ? "ios" : "android",
        pushTokenRef,
        status: "active",
        rotatedAt: new Date().toISOString(),
        revokedAt: null,
      });
      setRegistration("ready");
    } catch {
      setRegistration("failed");
      setNotice("通知暂未连接成功。你仍可打开收件箱查看任务，或稍后重试。");
    } finally {
      setBusy(false);
    }
  };
  const denied = Boolean(permission && !permission.granted && !permission.canAskAgain);
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Text style={styles.pageTitle}>设置</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{session.account.displayName}</Text>
        <Text style={styles.cardMeta}>{session.account.email}</Text>
        <Text style={styles.cardMeta}>连接密钥保存在此手机的系统安全存储中。</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>任务通知</Text>
        <Text style={styles.cardMeta}>通知只提醒任务状态，不包含对话内容或文件信息。</Text>
        <Text style={styles.eventText}>
          {denied
            ? "通知已关闭。请在系统设置中找到 openerx，开启通知。"
            : registration === "ready"
              ? "通知权限已开启，提醒订阅已登记。"
              : permission?.granted
                ? "系统已允许通知，连接后可接收任务提醒。"
                : "开启后及时获知任务进度和待处理事项。"}
        </Text>
        {notice ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {notice}
          </Text>
        ) : null}
        <PrimaryButton
          label={
            busy
              ? "正在连接…"
              : denied
                ? "前往系统设置"
                : permission?.granted
                  ? registration === "ready"
                    ? "管理通知"
                    : "重新连接通知"
                  : "允许通知"
          }
          disabled={busy || !permission}
          tone="neutral"
          onPress={() => {
            if (registration === "ready")
              void Linking.openSettings().catch(() =>
                setNotice("无法打开系统设置，请手动进入设置管理通知。"),
              );
            else void requestNotifications();
          }}
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>电脑与隐私</Text>
        <Text style={styles.cardMeta}>
          任务在电脑上执行，电脑需要保持在线。文件目录和系统权限仍需在电脑上设置。
        </Text>
        <Text style={styles.cardMeta}>
          手机不能远程唤醒电脑，也不能代替你完成支付或系统身份验证。
        </Text>
      </View>
      <PrimaryButton
        label="退出此手机"
        tone="danger"
        onPress={() => void onSignOut().catch(() => Alert.alert("退出失败", "请稍后重试。"))}
      />
    </ScrollView>
  );
}

function RemoteApp({
  api,
  session,
  onSignOut,
}: {
  api: MobileApi;
  session: MobileSession;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("hosts");
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [pairings, setPairings] = useState<RemoteDevicePairing[]>([]);
  const [connectionRequests, setConnectionRequests] = useState<RemoteConnectionRequest[]>([]);
  const [requestingHostId, setRequestingHostId] = useState<string | null>(null);
  const awaitingConnection = useRef<{ hostDeviceId: string; requestId: string } | null>(null);
  const refreshing = useRef(false);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const previousHost = useRef<string | null>(null);
  const [events, setEvents] = useState<DecryptedRemoteEvent[]>([]);
  const eventCache = useRef<DecryptedRemoteEvent[]>([]);
  const cursors = useRef<Record<string, string | null>>({});
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [projectsByHost, setProjectsByHost] = useState<Record<string, RemoteProjectSummary[]>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const latestSession = useRef(session);
  latestSession.current = session;
  const latestSignOut = useRef(onSignOut);
  latestSignOut.current = onSignOut;
  const [history, setHistory] = useState(() => emptyHistory(session.account.accountId));
  const [historySyncing, setHistorySyncing] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historySync = useRef<MobileHistorySync | null>(null);
  const refreshHistory = useRef<() => Promise<void>>(async () => undefined);
  const [selectedBranches, setSelectedBranches] = useState<Record<string, string>>({});
  const uploader = useMemo(
    () =>
      new MobileAttachmentUploader(
        api,
        session.account.accountId,
        () => latestSession.current.accessToken,
        readAttachment,
        attachmentChecksum,
      ),
    [api, session.account.accountId],
  );
  useEffect(() => {
    let active = true;
    const sync = new MobileHistorySync(
      session.account.accountId,
      (cursor) => api.pullHistory(latestSession.current.accessToken, cursor),
      nativeHistoryStorage(session.account.accountId),
      (state) => {
        if (active) setHistory(state);
      },
    );
    historySync.current = sync;
    const run = async () => {
      if (!active) return;
      setHistorySyncing(true);
      try {
        await sync.sync();
        if (active) setHistoryError(null);
      } catch (error) {
        if (active && error instanceof Error && error.message.startsWith("DEVICE_SESSION_")) {
          await sync.clear();
          await latestSignOut.current();
        } else if (active)
          setHistoryError(`历史同步未完成，显示已保存内容。${mobileErrorMessage(error)}`);
      } finally {
        if (active) setHistorySyncing(false);
      }
    };
    refreshHistory.current = run;
    void run();
    const timer = setInterval(() => void run(), 5_000);
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
    });
    return () => {
      active = false;
      sync.close();
      clearInterval(timer);
      foreground.remove();
    };
  }, [api, session.account.accountId]);
  const pending = useRef(
    new Map<string, { finish: (event: DecryptedRemoteEvent) => void; cancel: () => void }>(),
  );
  const controller = useMemo(
    () => (deviceId ? new RemoteController(api, session, deviceId) : null),
    [api, session, deviceId],
  );
  useEffect(() => {
    let active = true;
    void mobileDevice()
      .then((device) => {
        if (active) setDeviceId(device.deviceId);
      })
      .catch(() => {
        if (active) setError("无法读取此手机的连接信息，请重新打开应用。");
      });
    return () => {
      active = false;
      for (const request of pending.current.values()) request.cancel();
      pending.current.clear();
    };
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!controller || refreshing.current) return;
    refreshing.current = true;
    try {
      const [nextHosts, nextPairings, nextRequests] = await Promise.all([
        api.listHosts(session.accessToken),
        controller.listOwnPairings(),
        api.listConnectionRequests(session.accessToken),
      ]);
      setHosts((current) =>
        JSON.stringify(current) === JSON.stringify(nextHosts) ? current : nextHosts,
      );
      setPairings((current) =>
        JSON.stringify(current) === JSON.stringify(nextPairings) ? current : nextPairings,
      );
      setConnectionRequests((current) =>
        JSON.stringify(current) === JSON.stringify(nextRequests) ? current : nextRequests,
      );
      setSelectedHostId(
        (current) =>
          current ??
          nextHosts.find(
            (host) =>
              isRemoteHostReachable(host) &&
              nextPairings.some(
                (pairing) =>
                  pairing.hostDeviceId === host.hostDeviceId && pairing.status === "active",
              ),
          )?.hostDeviceId ??
          nextHosts[0]?.hostDeviceId ??
          null,
      );
      setConnectionError(null);
    } catch (caught) {
      setConnectionError(mobileErrorMessage(caught));
    } finally {
      refreshing.current = false;
    }
  }, [api, controller, session.accessToken]);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 3_000);
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(interval);
      foreground.remove();
    };
  }, [refresh]);
  useEffect(() => {
    if (previousHost.current !== selectedHostId) {
      previousHost.current = selectedHostId;
      setSelectedProjectId(null);
    }
  }, [selectedHostId]);
  useEffect(() => {
    const awaiting = awaitingConnection.current;
    if (!awaiting) return;
    if (
      pairings.some(
        (pairing) => pairing.hostDeviceId === awaiting.hostDeviceId && pairing.status === "active",
      )
    ) {
      awaitingConnection.current = null;
      setSelectedHostId(awaiting.hostDeviceId);
      setTab("tasks");
    } else if (
      connectionRequests.some(
        (request) =>
          request.requestId === awaiting.requestId &&
          ["rejected", "expired"].includes(request.status),
      )
    )
      awaitingConnection.current = null;
  }, [pairings, connectionRequests]);
  const connect = async (host: RemoteHost): Promise<void> => {
    if (!controller || requestingHostId) return;
    setSelectedHostId(host.hostDeviceId);
    if (
      pairings.some(
        (pairing) => pairing.hostDeviceId === host.hostDeviceId && pairing.status === "active",
      )
    ) {
      setTab("tasks");
      return;
    }
    setRequestingHostId(host.hostDeviceId);
    setError(null);
    try {
      const request = await controller.requestConnection(host.hostDeviceId);
      awaitingConnection.current = {
        hostDeviceId: host.hostDeviceId,
        requestId: request.requestId,
      };
      setConnectionRequests((current) => [
        request,
        ...current.filter((value) => value.hostDeviceId !== host.hostDeviceId),
      ]);
      await refresh();
    } catch (caught) {
      setError(mobileErrorMessage(caught));
    } finally {
      setRequestingHostId(null);
    }
  };
  const selectedHost = hosts.find((host) => host.hostDeviceId === selectedHostId) ?? null;
  const selectedPairing =
    pairings.find(
      (pairing) => pairing.hostDeviceId === selectedHostId && pairing.status === "active",
    ) ?? null;
  useEffect(() => {
    if (!controller || !selectedHostId || !selectedPairing) return;
    let active = true;
    let pulling = false;
    const pull = async (): Promise<void> => {
      if (pulling) return;
      pulling = true;
      try {
        const next = await controller.readEvents(
          selectedHostId,
          cursors.current[selectedHostId] ?? null,
          pairings,
        );
        if (!active) return;
        if (next.length) {
          eventCache.current = mergeRemoteEvents(eventCache.current, next);
          setEvents(eventCache.current);
          const cursor = next.at(-1)?.envelope.cursor ?? null;
          cursors.current[selectedHostId] = cursor;
          for (const event of next) {
            if (event.envelope.kind === "project.snapshot") {
              const snapshot = remoteProjectSnapshotPayloadSchema.safeParse(event.payload);
              if (snapshot.success)
                setProjectsByHost((current) => ({
                  ...current,
                  [event.envelope.hostDeviceId]: snapshot.data.projects,
                }));
            }
            if (typeof event.payload.commandId === "string")
              pending.current.get(event.payload.commandId)?.finish(event);
          }
          if (cursor)
            await api.acknowledgeCursor(session.accessToken, selectedHostId, null, cursor);
        }
      } catch (caught) {
        if (active) setConnectionError(mobileErrorMessage(caught));
      } finally {
        pulling = false;
      }
    };
    void pull();
    const interval = setInterval(() => void pull(), 1_500);
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void pull();
    });
    return () => {
      active = false;
      clearInterval(interval);
      foreground.remove();
    };
  }, [api, controller, pairings, selectedHostId, selectedPairing, session.accessToken]);
  const waitForResult = (commandId: string): Promise<DecryptedRemoteEvent> =>
    new Promise((resolve, reject) => {
      const finish = (event: DecryptedRemoteEvent) => {
        if (!event.payload.commandStatus) return;
        clearTimeout(timer);
        pending.current.delete(commandId);
        if (event.payload.commandStatus === "rejected")
          reject(new Error(String(event.payload.reason ?? "REMOTE_COMMAND_FAILED")));
        else resolve(event);
      };
      const timer = setTimeout(() => {
        pending.current.delete(commandId);
        reject(new Error("REMOTE_COMMAND_TIMEOUT"));
      }, 45_000);
      pending.current.set(commandId, {
        finish,
        cancel: () => {
          clearTimeout(timer);
          reject(new Error("SESSION_CHANGED"));
        },
      });
      const received = eventCache.current.find(
        (event) => event.payload.commandId === commandId && event.payload.commandStatus,
      );
      if (received) finish(received);
    });
  const command = async (
    payload: RemoteCommandPayload,
    targetId: string | null = conversationId,
  ): Promise<void> => {
    try {
      if (!controller || !selectedHost || !selectedPairing)
        throw new Error("REMOTE_HOST_NOT_SELECTED");
      setError(null);
      const target =
        payload.kind === "task.start" || payload.kind === "project.list" ? null : targetId;
      const revision = eventCache.current.reduce(
        (latest, event) =>
          event.envelope.conversationId === target &&
          event.envelope.hostDeviceId === selectedHost.hostDeviceId &&
          typeof event.payload.conversationRevision === "number"
            ? Math.max(latest, event.payload.conversationRevision)
            : latest,
        target
          ? Number(
              historySync.current?.state.objects[`conversation:${target}`]?.payload?.revision ?? 0,
            )
          : 0,
      );
      const receipt = await controller.send(selectedHost, selectedPairing, payload, {
        conversationId: target,
        baseRevision: revision,
      });
      if (receipt.status === "rejected" || receipt.status === "expired")
        throw new Error(receipt.resultCode ?? "REMOTE_COMMAND_FAILED");
      const outcome = await waitForResult(receipt.commandId);
      if (payload.kind === "task.start" && outcome.envelope.conversationId)
        setConversationId(outcome.envelope.conversationId);
      void refreshHistory.current();
    } catch (caught) {
      setError(mobileErrorMessage(caught));
      throw caught;
    }
  };
  useEffect(() => {
    if (!controller || !selectedHost || !isRemoteHostReachable(selectedHost) || !selectedPairing)
      return;
    void controller
      .send(
        selectedHost,
        selectedPairing,
        { kind: "project.list", includeArchived: false },
        { conversationId: null, baseRevision: 0 },
      )
      .catch((caught) => setConnectionError(mobileErrorMessage(caught)));
  }, [controller, selectedHost, selectedPairing]);
  const projects = selectedHostId ? (projectsByHost[selectedHostId] ?? []) : [];
  const hostEvents = useMemo(
    () => events.filter((event) => event.envelope.hostDeviceId === selectedHostId),
    [events, selectedHostId],
  );
  const tasks = useMemo(
    () => historyTasks(history, hostEvents, selectedBranches),
    [history, hostEvents, selectedBranches],
  );
  useEffect(() => {
    if (!conversationId) return;
    const record = history.objects[`conversation:${conversationId}`];
    if (record?.tombstone || record?.payload?.deletedAt) setConversationId(null);
  }, [history, conversationId]);
  const decide = async (
    event: DecryptedRemoteEvent,
    decision: "once" | "session" | "full_access" | "deny",
  ): Promise<void> => {
    await command(
      {
        kind: "permission.decide",
        attentionRequestId: String(event.payload.permissionRequestId),
        permissionRequestId: String(event.payload.permissionRequestId),
        payloadDigest: String(event.payload.payloadDigest),
        decision,
        deviceUnlocked: true,
        biometricVerified: false,
        reauthenticatedAt: new Date().toISOString(),
      },
      event.envelope.conversationId,
    );
  };
  const openTask = (id: string) => {
    setError(null);
    setConversationId(id);
    setTab("tasks");
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.app}
    >
      <SafeAreaView style={styles.flex}>
        <StatusBar style="light" />
        {!keyboardVisible ? (
          <View style={styles.appHeader}>
            <Text style={styles.brand}>openerx</Text>
            <Text style={styles.encryptedBadge}>端到端加密</Text>
          </View>
        ) : null}
        <View style={styles.body}>
          {tab === "hosts" ? (
            <HostsScreen
              hosts={hosts}
              pairings={pairings}
              requests={connectionRequests}
              requestingHostId={requestingHostId}
              onConnect={connect}
              selectedHostId={selectedHostId}
              onSelect={(host) => setSelectedHostId(host.hostDeviceId)}
              onRefresh={() => void refresh()}
              onPair={async (value) => {
                try {
                  await controller?.pairFromUrl(value);
                  await refresh();
                  setTab("tasks");
                } catch (caught) {
                  setError(mobileErrorMessage(caught));
                }
              }}
              onRevoke={async (pairing) => {
                try {
                  await api.revokePairing(session.accessToken, pairing.pairingId);
                  await refresh();
                } catch (caught) {
                  setError(mobileErrorMessage(caught));
                }
              }}
            />
          ) : null}
          <View style={[styles.flex, tab !== "tasks" ? { display: "none" } : null]}>
            <TasksScreen
              key={`${selectedHostId}:${conversationId}`}
              host={selectedHost}
              pairing={selectedPairing}
              projects={projects}
              selectedProjectId={selectedProjectId}
              conversationId={conversationId}
              tasks={tasks}
              keyboardVisible={keyboardVisible}
              onCommand={command}
              onRefreshProjects={() => command({ kind: "project.list", includeArchived: false })}
              onSelectProject={setSelectedProjectId}
              onNewTask={() => {
                setError(null);
                setConversationId(null);
              }}
              onOpenTask={openTask}
              uploader={uploader}
              historySyncing={historySyncing}
              historySyncedAt={history.syncedAt}
              historyError={historyError}
              onRefreshHistory={() => void refreshHistory.current()}
              onSelectBranch={(id, branchId) =>
                setSelectedBranches((current) => ({ ...current, [id]: branchId }))
              }
            />
          </View>
          {tab === "inbox" ? (
            <InboxScreen
              events={hostEvents}
              tasks={tasks}
              onDecision={decide}
              onOpenTask={openTask}
            />
          ) : null}
          {tab === "settings" ? (
            <SettingsScreen
              api={api}
              session={session}
              onSignOut={async () => {
                await historySync.current?.clear();
                await onSignOut();
              }}
            />
          ) : null}
        </View>
        {error || connectionError ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={[styles.errorBannerText, styles.flex]}>{error ?? connectionError}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭提示"
              style={styles.dismissError}
              onPress={() => {
                setError(null);
                setConnectionError(null);
              }}
            >
              <Text style={styles.buttonText}>关闭</Text>
            </Pressable>
          </View>
        ) : null}
        {!keyboardVisible ? (
          <View style={styles.tabBar}>
            {(
              [
                ["hosts", "电脑", "▣"],
                ["tasks", "任务", "⌁"],
                ["inbox", "收件箱", "◎"],
                ["settings", "设置", "⚙"],
              ] as const
            ).map(([value, label, icon]) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === value }}
                accessibilityLabel={label}
                onPress={() => setTab(value)}
                style={styles.tab}
              >
                <Text style={[styles.tabIcon, tab === value ? styles.tabActive : null]}>
                  {icon}
                </Text>
                <Text style={[styles.tabLabel, tab === value ? styles.tabActive : null]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

export default function App(): React.JSX.Element {
  const [session, setSession] = useState<MobileSession | null | undefined>(undefined);
  const currentSession = useRef<MobileSession | null>(null);
  const knownTokens = useRef(new Set<string>());
  const acceptSession = useCallback((next: MobileSession | null) => {
    if (next?.sessionId !== currentSession.current?.sessionId) knownTokens.current.clear();
    if (next) knownTokens.current.add(next.accessToken);
    currentSession.current = next;
    setSession(next);
  }, []);
  const api = useMemo(
    () =>
      new MobileApi(baseUrl || "https://platform.invalid", async (token, rejected) => {
        const current = currentSession.current;
        if (!current || !knownTokens.current.has(token)) throw new Error("SESSION_CHANGED");
        if (
          (rejected && token === current.accessToken) ||
          Date.parse(current.accessTokenExpiresAt) - Date.now() <= 30_000
        ) {
          const next = await refreshSession(baseUrl, current);
          if (currentSession.current?.sessionId !== current.sessionId)
            throw new Error("SESSION_CHANGED");
          acceptSession(next);
          return next.accessToken;
        }
        return current.accessToken;
      }),
    [acceptSession],
  );
  useEffect(() => {
    let active = true;
    void loadSession()
      .then(async (stored) => {
        if (!stored) {
          if (active) acceptSession(null);
          return;
        }
        try {
          const next =
            Date.parse(stored.accessTokenExpiresAt) - Date.now() > 30_000
              ? stored
              : await refreshSession(baseUrl, stored);
          if (active) acceptSession(next);
        } catch (error) {
          if (active) {
            if (error instanceof Error && error.message.startsWith("DEVICE_SESSION_")) {
              await nativeHistoryStorage(stored.account.accountId).clear();
              await clearSession();
              acceptSession(null);
            } else {
              // Network loss must not discard the account identity needed for cached history.
              acceptSession(stored);
            }
          }
        }
      })
      .catch(() => {
        if (active) acceptSession(null);
      });
    return () => {
      active = false;
    };
  }, [acceptSession]);
  useEffect(() => {
    if (!session) return;
    const maintenance = maintainMobileSession(
      session,
      (current) => refreshSession(baseUrl, current),
      (next) => {
        if (currentSession.current?.sessionId === next.sessionId) acceptSession(next);
      },
    );
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") maintenance.check();
    });
    return () => {
      maintenance.stop();
      subscription.remove();
    };
  }, [session, acceptSession]);
  if (session === undefined)
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color="#b7f397" />
      </SafeAreaView>
    );
  if (!session) return <Login api={api} onSignedIn={acceptSession} />;
  return (
    <RemoteApp
      key={session.sessionId}
      api={api}
      session={session}
      onSignOut={async () => {
        acceptSession(null);
        await clearSession();
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  app: { flex: 1, backgroundColor: "#111411" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#111411" },
  body: { flex: 1, minHeight: 0 },
  loginContent: { padding: 24, paddingTop: 34, paddingBottom: 40, flexGrow: 1 },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#30352f",
  },
  taskContent: { padding: 16, gap: 12, flexGrow: 1 },
  emptyTask: { paddingVertical: 24, gap: 12 },
  composer: {
    flexShrink: 0,
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#30352f",
    backgroundColor: "#151815",
  },
  composerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  messageBubble: { borderRadius: 14, padding: 14, gap: 8, backgroundColor: "#1b201b" },
  userBubble: { backgroundColor: "#263320" },
  messageAuthor: { color: "#b7d6a7", fontSize: 12, fontWeight: "700" },
  messageText: { color: "#eef2eb", fontSize: 16, lineHeight: 24 },
  historyRow: {
    minHeight: 48,
    paddingVertical: 10,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#3a403a",
  },
  dismissError: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  appHeader: {
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#30352f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: { color: "#f5f7f2", fontSize: 18, fontWeight: "800", letterSpacing: -0.4 },
  brandSub: { color: "#7d857d", fontSize: 10, marginTop: 1 },
  encryptedBadge: {
    color: "#a6d98d",
    fontSize: 11,
    borderWidth: 1,
    borderColor: "#3d5437",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  screenContent: { padding: 20, paddingBottom: 36, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  eyebrow: { color: "#8fa284", fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  pageTitle: { color: "#f3f5f0", fontSize: 31, fontWeight: "800", letterSpacing: -1, marginTop: 3 },
  pageCopy: { color: "#adb6aa", fontSize: 14, lineHeight: 21 },
  card: {
    backgroundColor: "#1b1f1b",
    borderWidth: 1,
    borderColor: "#2d332d",
    borderRadius: 16,
    padding: 15,
    gap: 8,
  },
  cardSelected: { borderColor: "#7ea869", backgroundColor: "#20271e" },
  cardTitle: { color: "#eef1eb", fontSize: 14, fontWeight: "700" },
  cardMeta: { color: "#a4afa1", fontSize: 13, lineHeight: 19 },
  hostHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  hostIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: "#30372e",
  },
  hostIconText: { color: "#b7f397", fontSize: 18 },
  statusDot: { width: 8, height: 8, borderRadius: 99, backgroundColor: "#6b716b" },
  statusDegraded: { backgroundColor: "#e2b95b" },
  statusOnline: {
    backgroundColor: "#8fd16c",
    shadowColor: "#8fd16c",
    shadowOpacity: 0.7,
    shadowRadius: 6,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, alignItems: "center" },
  chip: {
    color: "#9aa29a",
    backgroundColor: "#262b26",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  sectionTitle: { color: "#e5e9e2", fontWeight: "700", fontSize: 15 },
  sectionHint: { color: "#a4afa1", fontSize: 12, lineHeight: 18, flexShrink: 1 },
  button: {
    minHeight: 44,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: "#3a403a",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#242924",
  },
  buttonAccent: { backgroundColor: "#b7f397", borderColor: "#b7f397" },
  buttonDanger: { backgroundColor: "#30201f", borderColor: "#643d38" },
  buttonPressed: { opacity: 0.72 },
  buttonDisabled: { opacity: 0.38 },
  buttonText: { color: "#e7ede3", fontSize: 14, fontWeight: "700" },
  buttonAccentText: { color: "#172012", fontSize: 14, fontWeight: "800" },
  input: {
    minHeight: 46,
    color: "#f0f3ed",
    backgroundColor: "#191d19",
    borderWidth: 1,
    borderColor: "#303630",
    borderRadius: 11,
    paddingHorizontal: 13,
    fontSize: 16,
    paddingVertical: 10,
  },
  cameraFrame: { height: 320, borderRadius: 18, overflow: "hidden", backgroundColor: "#050605" },
  scanGuide: {
    position: "absolute",
    left: "18%",
    top: "20%",
    width: "64%",
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: "#b7f397",
    borderRadius: 16,
  },
  pairingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1b1f1b",
    padding: 13,
    borderRadius: 13,
  },
  hostStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: "#181c18",
    borderRadius: 12,
  },
  projectChoiceRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  projectChoice: {
    width: 154,
    minHeight: 68,
    justifyContent: "center",
    gap: 5,
    padding: 12,
    backgroundColor: "#1b1f1b",
    borderWidth: 1,
    borderColor: "#2d332d",
    borderRadius: 13,
  },
  projectChoiceSelected: { borderColor: "#7ea869", backgroundColor: "#20271e" },
  projectChoiceDisabled: { opacity: 0.72 },
  projectDetail: {
    gap: 8,
    padding: 13,
    borderRadius: 13,
    backgroundColor: "#181c18",
    borderWidth: 1,
    borderColor: "#2d332d",
  },
  projectDirectoryList: { gap: 7 },
  projectDirectoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#303630",
  },
  connectionConnected: { color: "#9ac884", fontSize: 10, fontWeight: "700" },
  connectionRequired: { color: "#e5ae75", fontSize: 10, fontWeight: "700" },
  transcript: { minHeight: 180, gap: 9, backgroundColor: "#151815", borderRadius: 14, padding: 13 },
  eventRow: { borderLeftWidth: 2, borderLeftColor: "#668654", paddingLeft: 10, gap: 3 },
  eventKind: {
    color: "#91b780",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  eventText: { color: "#dce1d9", fontSize: 12, lineHeight: 18 },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  attachmentRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  emptyCard: {
    alignItems: "center",
    gap: 6,
    padding: 28,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#363c36",
    borderRadius: 16,
  },
  emptyTitle: { color: "#dfe4dc", fontSize: 15, fontWeight: "700" },
  tabBar: {
    minHeight: 66,
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#30352f",
    backgroundColor: "#151815",
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  tabIcon: { color: "#a4afa1", fontSize: 19 },
  tabLabel: { color: "#a4afa1", fontSize: 12, fontWeight: "700" },
  tabActive: { color: "#b7f397" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 11,
    backgroundColor: "#4d2724",
    borderWidth: 1,
    borderColor: "#8b4c46",
  },
  errorBannerText: { color: "#ffd8d2", fontSize: 13, lineHeight: 19 },
  loginPage: { flex: 1, backgroundColor: "#111411", paddingHorizontal: 24, paddingTop: 76 },
  loginMark: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b7f397",
    marginBottom: 22,
  },
  loginMarkText: { color: "#182014", fontSize: 25, fontWeight: "900" },
  loginTitle: {
    color: "#f4f6f1",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 7,
    flexShrink: 1,
  },
  loginCopy: { color: "#adb6aa", fontSize: 15, lineHeight: 21, marginTop: 14, maxWidth: 340 },
  loginCard: {
    marginTop: 30,
    padding: 18,
    gap: 10,
    backgroundColor: "#1a1e1a",
    borderWidth: 1,
    borderColor: "#2e342e",
    borderRadius: 18,
  },
  fieldLabel: { color: "#b7c0b1", fontSize: 13, fontWeight: "700", marginTop: 3 },
  error: { color: "#ffb2a7", fontSize: 13, lineHeight: 19, marginTop: 9 },
});
