import type { RemoteCommandPayload, RemoteDevicePairing, RemoteHost } from "@openerx/contracts";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MobileApi } from "./src/mobile-api";
import { type DecryptedRemoteEvent, RemoteController } from "./src/remote-controller";
import {
  clearSession,
  loadSession,
  type MobileSession,
  mobileDevice,
  refreshSession,
  saveSession,
} from "./src/session";

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

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (!challengeId) {
        const challenge = await api.requestCode(email.trim());
        setChallengeId(challenge.challengeId);
      } else {
        const grant = await api.verifyCode(challengeId, code, await mobileDevice());
        onSignedIn(await saveSession(grant));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.loginPage}>
      <StatusBar style="light" />
      <View style={styles.loginMark}>
        <Text style={styles.loginMarkText}>O</Text>
      </View>
      <Text style={styles.eyebrow}>OPENERX REMOTE</Text>
      <Text style={styles.loginTitle}>掌控任务，不接管电脑。</Text>
      <Text style={styles.loginCopy}>
        手机只发送加密产品命令。Pi、文件和工具仍在已配对桌面执行。
      </Text>
      {!baseUrl ? (
        <Text style={styles.error}>请配置 EXPO_PUBLIC_OPENERX_PLATFORM_URL。</Text>
      ) : null}
      <View style={styles.loginCard}>
        <Text style={styles.fieldLabel}>账户邮箱</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          editable={!challengeId}
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#6d746d"
          style={styles.input}
          value={email}
        />
        {challengeId ? (
          <>
            <Text style={styles.fieldLabel}>六位验证码</Text>
            <TextInput
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor="#6d746d"
              style={styles.input}
              value={code}
            />
          </>
        ) : null}
        <PrimaryButton
          disabled={busy || !baseUrl || (!challengeId ? !email.trim() : !/^\d{6}$/u.test(code))}
          label={busy ? "请稍候…" : challengeId ? "验证并登录" : "发送验证码"}
          onPress={() => void submit()}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

function HostCard({
  host,
  selected,
  paired,
  onPress,
}: {
  host: RemoteHost;
  selected: boolean;
  paired: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={[styles.card, selected ? styles.cardSelected : null]}>
      <View style={styles.hostHeader}>
        <View style={styles.hostIcon}>
          <Text style={styles.hostIconText}>⌘</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{host.displayName}</Text>
          <Text style={styles.cardMeta}>
            {host.platform} · {host.arch} · {host.appVersion}
          </Text>
        </View>
        <View style={[styles.statusDot, host.presence === "online" ? styles.statusOnline : null]} />
      </View>
      <View style={styles.chipRow}>
        <Text style={styles.chip}>{host.presence}</Text>
        <Text style={styles.chip}>{paired ? "已配对" : "待配对"}</Text>
        <Text style={styles.chip}>revision {host.revision}</Text>
      </View>
    </Pressable>
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
}: {
  hosts: RemoteHost[];
  pairings: RemoteDevicePairing[];
  selectedHostId: string | null;
  onSelect: (host: RemoteHost) => void;
  onRefresh: () => void;
  onPair: (value: string) => Promise<void>;
  onRevoke: (pairing: RemoteDevicePairing) => Promise<void>;
}): React.JSX.Element {
  const [scanning, setScanning] = useState(false);
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
          <Text style={styles.eyebrow}>EXECUTION HOSTS</Text>
          <Text style={styles.pageTitle}>主机</Text>
        </View>
        <PrimaryButton label="刷新" onPress={onRefresh} tone="neutral" />
      </View>
      <Text style={styles.pageCopy}>仅在线且已配对的桌面可接受新命令；离线历史仍可查看。</Text>
      {hosts.map((host) => (
        <HostCard
          host={host}
          key={host.hostDeviceId}
          onPress={() => onSelect(host)}
          paired={pairings.some(
            (pairing) => pairing.hostDeviceId === host.hostDeviceId && pairing.status === "active",
          )}
          selected={host.hostDeviceId === selectedHostId}
        />
      ))}
      {hosts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>还没有 Remote 主机</Text>
          <Text style={styles.cardMeta}>先在桌面“设置 → 手机远程控制”开启 Remote。</Text>
        </View>
      ) : null}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>配对新主机</Text>
        <Text style={styles.sectionHint}>一次性 · 同账户 · 2 分钟</Text>
      </View>
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
            })()
          }
        />
      )}
      <TextInput
        autoCapitalize="none"
        onChangeText={setManualValue}
        placeholder="开发测试：粘贴 openerx:// 配对链接"
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
      {pairings
        .filter(({ status }) => status === "active")
        .map((pairing) => (
          <View key={pairing.pairingId} style={styles.pairingRow}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>配对 {pairing.pairingId.slice(0, 8)}</Text>
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
  conversationId,
  activeMessageId,
  events,
  onCommand,
  onNewTask,
}: {
  host: RemoteHost | null;
  pairing: RemoteDevicePairing | null;
  conversationId: string | null;
  activeMessageId: string | null;
  events: DecryptedRemoteEvent[];
  onCommand: (payload: RemoteCommandPayload) => Promise<void>;
  onNewTask: () => void;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invoke = async (payload: RemoteCommandPayload): Promise<void> => {
    setBusy(true);
    try {
      await onCommand(payload);
      setText("");
    } finally {
      setBusy(false);
    }
  };
  const messageEvents = events.filter((event) => event.envelope.conversationId === conversationId);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.screenContent}>
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.eyebrow}>REMOTE TASK</Text>
            <Text style={styles.pageTitle}>任务</Text>
          </View>
          <PrimaryButton label="新任务" onPress={onNewTask} tone="neutral" />
        </View>
        <View style={styles.hostStrip}>
          <View
            style={[styles.statusDot, host?.presence === "online" ? styles.statusOnline : null]}
          />
          <Text style={styles.cardTitle}>{host?.displayName ?? "未选择主机"}</Text>
          <Text style={styles.cardMeta}>{pairing ? "端到端加密" : "未配对"}</Text>
        </View>
        <View style={styles.transcript}>
          {messageEvents.map((event) => (
            <View key={event.envelope.eventId} style={styles.eventRow}>
              <Text style={styles.eventKind}>{event.envelope.kind}</Text>
              <Text style={styles.eventText}>
                {String(
                  event.payload.delta ??
                    event.payload.reason ??
                    event.payload.runStatus ??
                    event.payload.toolStatus ??
                    "状态已更新",
                )}
              </Text>
            </View>
          ))}
          {messageEvents.length === 0 ? (
            <Text style={styles.pageCopy}>输入目标，从手机启动一项真实桌面任务。</Text>
          ) : null}
        </View>
        <TextInput
          multiline
          onChangeText={setText}
          placeholder={
            conversationId ? "继续说明，或选择 Steer / Queue" : "描述你希望桌面完成的任务"
          }
          placeholderTextColor="#6d746d"
          style={[styles.input, styles.promptInput]}
          value={text}
        />
        <View style={styles.actionGrid}>
          <PrimaryButton
            disabled={busy || !text.trim() || !host || !pairing}
            label={conversationId ? "发送" : "Start"}
            onPress={() =>
              void invoke({
                kind: conversationId ? "session.prompt" : "task.start",
                text: text.trim(),
                clientOperationId: `mobile:${Date.now()}`,
              })
            }
          />
          <PrimaryButton
            disabled={busy || !text.trim() || !conversationId}
            label="Steer"
            onPress={() => void invoke({ kind: "session.steer", text: text.trim() })}
            tone="neutral"
          />
          <PrimaryButton
            disabled={busy || !text.trim() || !conversationId}
            label="Queue"
            onPress={() => void invoke({ kind: "session.follow_up", text: text.trim() })}
            tone="neutral"
          />
          <PrimaryButton
            disabled={busy || !conversationId || !activeMessageId}
            label="Stop"
            onPress={() =>
              void invoke({ kind: "session.abort", assistantMessageId: activeMessageId as string })
            }
            tone="danger"
          />
        </View>
        <View style={styles.attachmentRow}>
          <PrimaryButton
            label="图片"
            tone="neutral"
            onPress={() =>
              void ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] }).then(
                (result) => {
                  if (!result.canceled) setAttachment(result.assets[0]?.fileName ?? "已选择图片");
                },
              )
            }
          />
          <PrimaryButton
            label="文件"
            tone="neutral"
            onPress={() =>
              void DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true }).then(
                (result) => {
                  if (!result.canceled) setAttachment(result.assets[0]?.name ?? "已选择文件");
                },
              )
            }
          />
          <Text style={styles.sectionHint}>
            {attachment ?? "选择器已接入；对象上传需在真机发布门禁验证"}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InboxScreen({
  events,
  onDecision,
}: {
  events: DecryptedRemoteEvent[];
  onDecision: (event: DecryptedRemoteEvent, decision: "once" | "session" | "deny") => Promise<void>;
}): React.JSX.Element {
  const attention = events.filter(({ envelope }) =>
    ["attention.requested", "review.available", "message.completed", "message.failed"].includes(
      envelope.kind,
    ),
  );
  return (
    <FlatList
      contentContainerStyle={styles.screenContent}
      data={attention}
      keyExtractor={({ envelope }) => envelope.eventId}
      ListHeaderComponent={
        <>
          <Text style={styles.eyebrow}>ATTENTION & REVIEW</Text>
          <Text style={styles.pageTitle}>收件箱</Text>
          <Text style={styles.pageCopy}>
            审批只回应桌面当前待处理项；最终判断仍由同一 Capability Broker 完成。
          </Text>
        </>
      }
      ListEmptyComponent={
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>没有待处理事项</Text>
          <Text style={styles.cardMeta}>任务完成、失败、问题和审批会出现在这里。</Text>
        </View>
      }
      renderItem={({ item }) => {
        const permissionId =
          typeof item.payload.permissionRequestId === "string"
            ? item.payload.permissionRequestId
            : null;
        return (
          <View style={styles.card}>
            <Text style={styles.eventKind}>{item.envelope.kind}</Text>
            <Text style={styles.cardTitle}>
              {String(item.payload.target ?? item.payload.type ?? "任务状态")}
            </Text>
            <Text style={styles.cardMeta}>
              {String(item.payload.actions ?? item.payload.reason ?? item.envelope.occurredAt)}
            </Text>
            {permissionId ? (
              <View style={styles.chipRow}>
                <PrimaryButton label="本次允许" onPress={() => void onDecision(item, "once")} />
                <PrimaryButton
                  label="当前对话"
                  onPress={() => void onDecision(item, "session")}
                  tone="neutral"
                />
                <PrimaryButton
                  label="拒绝"
                  onPress={() => void onDecision(item, "deny")}
                  tone="danger"
                />
              </View>
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
  const [notifications, setNotifications] = useState<"unknown" | "granted" | "denied">("unknown");
  const requestNotifications = async (): Promise<void> => {
    const result = await Notifications.requestPermissionsAsync();
    setNotifications(result.granted ? "granted" : "denied");
    if (!result.granted) return;
    try {
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
    } catch {
      // Simulators and unsigned development clients may not expose a native push token.
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>DEVICE & PRIVACY</Text>
      <Text style={styles.pageTitle}>设置</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{session.account.displayName}</Text>
        <Text style={styles.cardMeta}>{session.account.email}</Text>
        <Text style={styles.cardMeta}>控制设备私钥：系统安全存储 · 仅本机</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>通知</Text>
        <Text style={styles.cardMeta}>
          推送只含不透明对象 ID，不含 Prompt、回答、Diff、路径或凭证。
        </Text>
        <PrimaryButton
          label={notifications === "granted" ? "已允许通知" : "允许通知"}
          onPress={() => void requestNotifications()}
          tone="neutral"
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>远程边界</Text>
        <Text style={styles.cardMeta}>
          不能新增桌面文件 Scope、系统权限、支付认证，也不提供远程终端或唤醒。
        </Text>
      </View>
      <PrimaryButton label="退出此手机" onPress={() => void onSignOut()} tone="danger" />
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
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [events, setEvents] = useState<DecryptedRemoteEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [revisionByConversation, setRevisionByConversation] = useState<Record<string, number>>({});
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controller, setController] = useState<RemoteController | null>(null);

  useEffect(() => {
    void mobileDevice().then((device) =>
      setController(new RemoteController(api, session, device.deviceId)),
    );
  }, [api, session]);
  const refresh = useCallback(async () => {
    try {
      const [nextHosts, nextPairings] = await Promise.all([
        api.listHosts(session.accessToken),
        api.listPairings(session.accessToken),
      ]);
      setHosts(nextHosts);
      setPairings(nextPairings);
      setSelectedHostId(
        (current) =>
          current ??
          nextHosts.find(({ presence }) => presence === "online")?.hostDeviceId ??
          nextHosts[0]?.hostDeviceId ??
          null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "REMOTE_REFRESH_FAILED");
    }
  }, [api, session.accessToken]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedHost = hosts.find(({ hostDeviceId }) => hostDeviceId === selectedHostId) ?? null;
  const selectedPairing =
    pairings.find(
      ({ hostDeviceId, status }) => hostDeviceId === selectedHostId && status === "active",
    ) ?? null;

  useEffect(() => {
    if (!controller || !selectedHostId || !selectedPairing) return;
    let active = true;
    const pull = async (): Promise<void> => {
      try {
        const next = await controller.readEvents(selectedHostId, cursor, pairings);
        if (!active || next.length === 0) return;
        setEvents((current) => [...current, ...next].slice(-500));
        const latestCursor = next.at(-1)?.envelope.cursor ?? null;
        setCursor(latestCursor);
        for (const event of next) {
          const id = event.envelope.conversationId;
          if (id) {
            setConversationId((current) => current ?? id);
            const revision = event.payload.conversationRevision;
            if (typeof revision === "number")
              setRevisionByConversation((current) => ({ ...current, [id]: revision }));
          }
          if (typeof event.payload.messageId === "string")
            setActiveMessageId(event.payload.messageId);
        }
        if (latestCursor)
          await api.acknowledgeCursor(session.accessToken, selectedHostId, null, latestCursor);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "REMOTE_EVENT_FAILED");
      }
    };
    void pull();
    const interval = setInterval(() => void pull(), 1_500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [api, controller, cursor, pairings, selectedHostId, selectedPairing, session.accessToken]);

  const command = async (payload: RemoteCommandPayload): Promise<void> => {
    if (!controller || !selectedHost || !selectedPairing)
      throw new Error("REMOTE_HOST_NOT_SELECTED");
    try {
      await controller.send(selectedHost, selectedPairing, payload, {
        conversationId,
        baseRevision: conversationId ? (revisionByConversation[conversationId] ?? 0) : 0,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "REMOTE_COMMAND_FAILED";
      setError(message);
      throw caught;
    }
  };

  const decide = async (
    event: DecryptedRemoteEvent,
    decision: "once" | "session" | "deny",
  ): Promise<void> => {
    const risk = String(event.payload.risk ?? "L1");
    let biometricVerified = false;
    if (Number(risk.slice(1)) >= 3) {
      const authentication = await LocalAuthentication.authenticateAsync({
        promptMessage: "确认远程审批",
        cancelLabel: "取消",
      });
      if (!authentication.success) throw new Error("REMOTE_REAUTHENTICATION_REQUIRED");
      biometricVerified = true;
    }
    await command({
      kind: "permission.decide",
      attentionRequestId: String(event.payload.permissionRequestId),
      permissionRequestId: String(event.payload.permissionRequestId),
      payloadDigest: String(event.payload.payloadDigest),
      decision,
      deviceUnlocked: true,
      biometricVerified,
      reauthenticatedAt: new Date().toISOString(),
    });
  };

  const pair = async (value: string): Promise<void> => {
    if (!controller) return;
    try {
      await controller.pairFromUrl(value);
      await refresh();
      setTab("tasks");
    } catch (caught) {
      Alert.alert("配对失败", caught instanceof Error ? caught.message : "REMOTE_PAIRING_FAILED");
    }
  };

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.brand}>OpenerX</Text>
          <Text style={styles.brandSub}>Remote Companion</Text>
        </View>
        <Text style={styles.encryptedBadge}>◈ E2EE</Text>
      </View>
      <View style={styles.body}>
        {tab === "hosts" ? (
          <HostsScreen
            hosts={hosts}
            pairings={pairings}
            selectedHostId={selectedHostId}
            onSelect={(host) => setSelectedHostId(host.hostDeviceId)}
            onRefresh={() => void refresh()}
            onPair={pair}
            onRevoke={async (pairing) => {
              await api.revokePairing(session.accessToken, pairing.pairingId);
              await refresh();
            }}
          />
        ) : null}
        {tab === "tasks" ? (
          <TasksScreen
            host={selectedHost}
            pairing={selectedPairing}
            conversationId={conversationId}
            activeMessageId={activeMessageId}
            events={events}
            onCommand={command}
            onNewTask={() => {
              setConversationId(null);
              setActiveMessageId(null);
            }}
          />
        ) : null}
        {tab === "inbox" ? <InboxScreen events={events} onDecision={decide} /> : null}
        {tab === "settings" ? (
          <SettingsScreen api={api} session={session} onSignOut={onSignOut} />
        ) : null}
      </View>
      {error ? (
        <Pressable onPress={() => setError(null)} style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </Pressable>
      ) : null}
      <View style={styles.tabBar}>
        {(
          [
            ["hosts", "主机", "▣"],
            ["tasks", "任务", "⌁"],
            ["inbox", "收件箱", "◎"],
            ["settings", "设置", "⚙"],
          ] as const
        ).map(([value, label, icon]) => (
          <Pressable key={value} onPress={() => setTab(value)} style={styles.tab}>
            <Text style={[styles.tabIcon, tab === value ? styles.tabActive : null]}>{icon}</Text>
            <Text style={[styles.tabLabel, tab === value ? styles.tabActive : null]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App(): React.JSX.Element {
  const api = useMemo(() => new MobileApi(baseUrl || "https://platform.invalid"), []);
  const [session, setSession] = useState<MobileSession | null | undefined>(undefined);
  useEffect(() => {
    void loadSession().then(async (stored) => {
      if (!stored) {
        setSession(null);
        return;
      }
      try {
        setSession(
          Date.parse(stored.accessTokenExpiresAt) - Date.now() > 30_000
            ? stored
            : await refreshSession(baseUrl, stored),
        );
      } catch {
        await clearSession();
        setSession(null);
      }
    });
  }, []);
  if (session === undefined)
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color="#b7f397" />
      </SafeAreaView>
    );
  if (!session) return <Login api={api} onSignedIn={setSession} />;
  return (
    <RemoteApp
      api={api}
      session={session}
      onSignOut={async () => {
        await clearSession();
        setSession(null);
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  app: { flex: 1, backgroundColor: "#111411" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#111411" },
  body: { flex: 1 },
  appHeader: {
    minHeight: 62,
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
  pageCopy: { color: "#8d958d", fontSize: 13, lineHeight: 19 },
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
  cardMeta: { color: "#858d85", fontSize: 11, lineHeight: 16 },
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
  sectionHint: { color: "#778077", fontSize: 10, flexShrink: 1 },
  button: {
    minHeight: 38,
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
  buttonText: { color: "#dfe4dc", fontSize: 12, fontWeight: "700" },
  buttonAccentText: { color: "#172012", fontSize: 12, fontWeight: "800" },
  input: {
    minHeight: 46,
    color: "#f0f3ed",
    backgroundColor: "#191d19",
    borderWidth: 1,
    borderColor: "#303630",
    borderRadius: 11,
    paddingHorizontal: 13,
    fontSize: 13,
  },
  promptInput: { minHeight: 110, paddingTop: 13, textAlignVertical: "top" },
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
  tabIcon: { color: "#6f776f", fontSize: 17 },
  tabLabel: { color: "#6f776f", fontSize: 9, fontWeight: "700" },
  tabActive: { color: "#b7f397" },
  errorBanner: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 76,
    padding: 12,
    borderRadius: 11,
    backgroundColor: "#4d2724",
    borderWidth: 1,
    borderColor: "#8b4c46",
  },
  errorBannerText: { color: "#ffd8d2", fontSize: 11 },
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
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -1.4,
    marginTop: 7,
    maxWidth: 330,
  },
  loginCopy: { color: "#8b938b", fontSize: 14, lineHeight: 21, marginTop: 14, maxWidth: 340 },
  loginCard: {
    marginTop: 30,
    padding: 18,
    gap: 10,
    backgroundColor: "#1a1e1a",
    borderWidth: 1,
    borderColor: "#2e342e",
    borderRadius: 18,
  },
  fieldLabel: { color: "#a9b0a9", fontSize: 11, fontWeight: "700", marginTop: 3 },
  error: { color: "#e79b91", fontSize: 11, lineHeight: 16, marginTop: 9 },
});
