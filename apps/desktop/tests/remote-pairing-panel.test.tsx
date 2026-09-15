// @vitest-environment jsdom
import {
  type DesktopBridge,
  type RemotePairingChallenge,
  remotePairingChallengeSchema,
} from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QRCode from "qrcode";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemotePairingPanel } from "../src/renderer/RemotePairingPanel";

const qrName = "openerx Remote 一次性配对二维码";

function createChallenge(): RemotePairingChallenge {
  return {
    version: 1,
    challengeId: crypto.randomUUID(),
    accountId: "11111111-1111-4111-8111-111111111111",
    hostDeviceId: "22222222-2222-4222-8222-222222222222",
    oneTimeNonce: "n".repeat(43),
    hostPublicKey: "k".repeat(43),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  };
}

function mountPanel() {
  return render(
    <StrictMode>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
      >
        <RemotePairingPanel />
      </QueryClientProvider>
    </StrictMode>,
  );
}

function setup(challenge = createChallenge()) {
  const createRemotePairingChallenge = vi.fn().mockResolvedValue(challenge);
  window.openerx = { createRemotePairingChallenge } as unknown as DesktopBridge;
  return { challenge, createRemotePairingChallenge, ...mountPanel() };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("desktop phone pairing QR", () => {
  it("automatically renders a QR for the mobile pairing protocol once in StrictMode", async () => {
    const encode = vi.spyOn(QRCode, "toString");
    const { challenge, createRemotePairingChallenge } = setup();
    const image = await screen.findByRole("img", { name: qrName });
    expect(createRemotePairingChallenge).toHaveBeenCalledOnce();
    expect(encode).toHaveBeenCalledOnce();
    const url = new URL(String(encode.mock.calls[0]?.[0]));
    expect([url.protocol, url.hostname, url.pathname]).toEqual(["openerx:", "remote", "/pair"]);
    expect(
      remotePairingChallengeSchema.parse(JSON.parse(url.searchParams.get("payload") ?? "null")),
    ).toEqual(challenge);
    const svg = decodeURIComponent(image.getAttribute("src")?.split(",").slice(1).join(",") ?? "");
    expect(svg).toContain("<svg");
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(screen.getByText(/进入“主机”，点击“扫描桌面配对码”/)).toBeTruthy();
    expect(screen.getByText(/一次性使用 · 剩余/)).toBeTruthy();
  });

  it("hides the previous QR while generating its replacement", async () => {
    const { createRemotePairingChallenge } = setup();
    const previousSource = (await screen.findByRole("img", { name: qrName })).getAttribute("src");
    const next = createChallenge();
    let resolveNext: (value: RemotePairingChallenge) => void = () => undefined;
    createRemotePairingChallenge.mockReturnValueOnce(
      new Promise<RemotePairingChallenge>((resolve) => {
        resolveNext = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "重新生成二维码" }));
    await screen.findByText("正在生成二维码…");
    expect(screen.queryByRole("img", { name: qrName })).toBeNull();
    expect(screen.getByRole("button", { name: "正在生成…" })).toHaveProperty("disabled", true);
    await act(async () => resolveNext(next));
    expect((await screen.findByRole("img", { name: qrName })).getAttribute("src")).not.toBe(
      previousSource,
    );
  });

  it("removes an expired QR and lets the user generate a fresh challenge", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const { createRemotePairingChallenge } = setup();
    await screen.findByRole("img", { name: qrName });
    await act(async () => vi.advanceTimersByTime(121_000));
    expect(screen.queryByRole("img", { name: qrName })).toBeNull();
    expect(screen.getByText("二维码已过期")).toBeTruthy();
    createRemotePairingChallenge.mockResolvedValueOnce(createChallenge());
    fireEvent.click(screen.getByRole("button", { name: "重新生成二维码" }));
    await screen.findByRole("img", { name: qrName });
    expect(screen.queryByText("二维码已过期")).toBeNull();
  });

  it("shows QR encoding failures and recovers when generation is retried", async () => {
    vi.spyOn(QRCode, "toString").mockRejectedValueOnce(new Error("QR encoding unavailable"));
    const { createRemotePairingChallenge } = setup();
    expect((await screen.findByRole("alert")).textContent).toBe("无法生成配对二维码，请重试。");
    expect(screen.queryByRole("img", { name: qrName })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试生成二维码" }));
    await screen.findByRole("img", { name: qrName });
    expect(createRemotePairingChallenge).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps an old QR hidden if requesting its replacement fails", async () => {
    const { createRemotePairingChallenge } = setup();
    await screen.findByRole("img", { name: qrName });
    createRemotePairingChallenge.mockRejectedValueOnce(new Error("Remote service unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "重新生成二维码" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("img", { name: qrName })).toBeNull();
    expect(createRemotePairingChallenge).toHaveBeenCalledTimes(2);
  });

  it("does not restore an in-flight QR after the panel is closed and reopened", async () => {
    const oldChallenge = createChallenge();
    const nextChallenge = createChallenge();
    let resolveOld: (value: RemotePairingChallenge) => void = () => undefined;
    const createRemotePairingChallenge = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<RemotePairingChallenge>((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValueOnce(nextChallenge);
    window.openerx = { createRemotePairingChallenge } as unknown as DesktopBridge;
    const panel = mountPanel();
    await waitFor(() => expect(createRemotePairingChallenge).toHaveBeenCalledOnce());
    panel.unmount();
    mountPanel();
    const source = (await screen.findByRole("img", { name: qrName })).getAttribute("src");
    await act(async () => resolveOld(oldChallenge));
    expect(screen.getByRole("img", { name: qrName }).getAttribute("src")).toBe(source);
    expect(createRemotePairingChallenge).toHaveBeenCalledTimes(2);
  });
});
