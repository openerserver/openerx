import { QrCode } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

export function RemotePairingPanel(): React.JSX.Element {
  const requested = useRef(false);
  const [now, setNow] = useState(Date.now);
  const {
    mutate: generate,
    data,
    isPending,
    isIdle,
    error,
  } = useMutation({
    mutationFn: async () => {
      const challenge = await window.openerx.createRemotePairingChallenge();
      const pairingUrl = `openerx://remote/pair?payload=${encodeURIComponent(JSON.stringify(challenge))}`;
      // SVG keeps the dense pairing payload sharp at the displayed size and
      // avoids depending on a canvas context in the desktop renderer.
      const svg = await QRCode.toString(pairingUrl, {
        type: "svg",
        width: 288,
        margin: 4,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      });
      return { challenge, dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
    },
  });

  useEffect(() => {
    // React StrictMode replays effects; request only one challenge per opening.
    if (requested.current) return;
    requested.current = true;
    generate();
  }, [generate]);

  useEffect(() => {
    if (!data) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [data]);

  const loading = isIdle || isPending;
  const remaining = data
    ? Math.max(0, Math.ceil((Date.parse(data.challenge.expiresAt) - now) / 1_000))
    : 0;
  const expired = Boolean(data && remaining === 0);
  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <section className="remote-pairing-panel" aria-label="手机扫码配对">
      <div className="remote-pairing-code">
        {data && !loading && !expired ? (
          <img src={data.dataUrl} width={288} height={288} alt="openerx Remote 一次性配对二维码" />
        ) : (
          <div className="remote-pairing-placeholder" role="status">
            <QrCode size={44} aria-hidden="true" />
            <span>{loading ? "正在生成二维码…" : expired ? "二维码已过期" : "二维码生成失败"}</span>
          </div>
        )}
      </div>
      <div className="remote-pairing-instructions">
        <strong>用手机扫描二维码配对</strong>
        <p>在手机 openerx 中登录同一账户，进入“主机”，点击“扫描桌面配对码”。</p>
        {data && !loading && !expired ? (
          <span>一次性使用 · 剩余 {countdown}</span>
        ) : expired ? (
          <p>请重新生成二维码后再扫描。</p>
        ) : null}
        {error ? (
          <p className="inline-error" role="alert">
            无法生成配对二维码，请重试。
          </p>
        ) : null}
        <button type="button" onClick={() => generate()} disabled={loading}>
          <QrCode size={16} aria-hidden="true" />
          {loading ? "正在生成…" : error ? "重试生成二维码" : "重新生成二维码"}
        </button>
      </div>
    </section>
  );
}
