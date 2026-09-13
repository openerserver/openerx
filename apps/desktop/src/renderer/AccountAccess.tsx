import type { AccountState, EmailChallenge } from "@openerx/contracts";
import { ArrowRight, CheckCircle, Desktop } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import "./account-access.css";

/** Shared account presentation; authentication and service configuration stay with the caller. */
export function AccountAccessFrame({
  title,
  description,
  children,
  onContinue,
  onConfigureModel,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onContinue: () => void;
  onConfigureModel: () => void;
}): React.JSX.Element {
  return (
    <section className="account-access" id="account-section" tabIndex={-1} aria-label="账户状态">
      <div className="account-access-panel">
        <header className="account-access-heading">
          <div className="account-access-brand">
            <img src="/assets/openerx-mark.svg" alt="" />
            <span>openerx</span>
          </div>
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        {children}
        <footer className="account-access-local">
          <button type="button" className="account-access-continue" onClick={onContinue}>
            <Desktop size={18} aria-hidden="true" />
            <span>直接使用</span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <p>无需登录，即可使用本机功能。</p>
          <button type="button" className="account-access-link" onClick={onConfigureModel}>
            配置自有 API Key 或本地模型
          </button>
        </footer>
      </div>
    </section>
  );
}

function loginError(error: Error): string {
  const messages: Record<string, string> = {
    PLATFORM_ENDPOINT_NOT_CONFIGURED: "此版本尚未连接账号服务，可以直接使用本机功能。",
    OS_CREDENTIAL_STORE_UNAVAILABLE:
      "无法安全保存登录信息，请解锁系统凭据存储后重试。本机功能仍可使用。",
    CHALLENGE_RATE_LIMITED: "验证码发送较频繁，请稍后重试。",
    CHALLENGE_CODE_INVALID: "验证码不正确，请检查后重试。",
    CHALLENGE_EXPIRED: "验证码已过期，请重新发送。",
    CHALLENGE_ATTEMPTS_EXCEEDED: "验证码错误次数过多，请重新发送。",
    CHALLENGE_CONSUMED: "此验证码已使用，请重新发送。",
    CHALLENGE_INVALID: "本次验证已失效，请重新发送。",
  };
  return (
    Object.entries(messages).find(([code]) => error.message.includes(code))?.[1] ??
    "暂时无法连接账号服务，请检查网络后重试。本机功能仍可使用。"
  );
}

export function AccountAccess({
  state,
  loading,
  error,
  onRetry,
  onSignedIn,
  onContinue,
  onConfigureModel,
}: {
  state?: AccountState;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  onSignedIn: (state: AccountState) => void;
  onContinue: () => void;
  onConfigureModel: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now);
  const submitting = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const expired = challenge !== null && new Date(challenge.expiresAt).getTime() <= now;
  useEffect(() => {
    if (!challenge) return;
    codeInput.current?.focus();
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  const login = useMutation({
    mutationFn: async (action: "request" | "verify") => {
      if (action === "verify" && challenge) {
        // Read the visible field so native OTP autofill is included in submission.
        const visibleCode = codeInput.current?.value ?? code;
        const result = await window.openerx.verifyEmailCode({
          challengeId: challenge.challengeId,
          code: visibleCode,
        });
        onSignedIn(result);
        setChallenge(null);
        setCode("");
      } else {
        const next = await window.openerx.requestEmailCode({
          email: challenge?.email ?? email.trim(),
        });
        setNow(Date.now());
        setChallenge(next);
        setCode("");
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const submit = (action: "request" | "verify"): void => {
    if (submitting.current) return;
    if (action === "verify" && (expired || !/^[0-9]{6}$/.test(codeInput.current?.value ?? code)))
      return;
    submitting.current = true;
    login.mutate(action);
  };
  const signedIn = state?.status === "signed_in" && state.session !== null;
  const unconfigured = state?.reason === "PLATFORM_ENDPOINT_NOT_CONFIGURED";
  const unavailable = state?.status === "unavailable" || Boolean(error);
  const title = signedIn
    ? "你的账号"
    : challenge
      ? "输入验证码"
      : unconfigured
        ? "欢迎使用 openerx"
        : "登录或注册";
  const description = signedIn
    ? "管理你的登录与云端连接。"
    : challenge
      ? `验证码已发送至 ${challenge.email}`
      : unconfigured
        ? "从本机开始，使用你选择的模型。"
        : "使用邮箱连接账号，也可以直接使用本机功能。";

  return (
    <AccountAccessFrame
      title={title}
      description={description}
      onContinue={onContinue}
      onConfigureModel={onConfigureModel}
    >
      {signedIn ? (
        <div className="account-access-identity">
          <div className="account-access-summary">
            <strong>{state.account?.displayName}</strong>
            <span>
              <CheckCircle size={15} aria-hidden="true" />
              已登录
            </span>
          </div>
          <dl>
            <div>
              <dt>邮箱</dt>
              <dd>{state.account?.email}</dd>
            </div>
            <div>
              <dt>登录方式</dt>
              <dd>邮箱验证码</dd>
            </div>
          </dl>
        </div>
      ) : loading ? (
        <p className="account-access-notice" role="status">
          正在读取账号状态…
        </p>
      ) : unavailable ? (
        <div className="account-access-notice" role={error ? "alert" : "status"}>
          <strong>{unconfigured ? "本机模式" : "账号服务暂时不可用"}</strong>
          <p>
            {unconfigured
              ? "此版本尚未连接账号服务。你的本机项目、聊天和文件可继续使用。"
              : "请稍后重试，或继续使用本机功能。"}
          </p>
          {!unconfigured ? (
            <button type="button" className="account-access-link" onClick={onRetry}>
              重新连接
            </button>
          ) : null}
        </div>
      ) : state ? (
        <form
          className="account-access-form"
          aria-label={challenge ? "验证码登录" : "邮箱登录"}
          onSubmit={(event) => {
            event.preventDefault();
            submit(challenge ? "verify" : "request");
          }}
        >
          {state.status === "reauth_required" && !challenge ? (
            <p className="account-access-notice" role="status">
              登录已失效，请重新验证邮箱。本机内容仍保留。
            </p>
          ) : null}
          {challenge ? (
            <>
              <label htmlFor="account-code">六位验证码</label>
              <input
                ref={codeInput}
                className="account-access-code"
                id="account-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="6 位验证码"
                value={code}
                disabled={login.isPending || expired}
                onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ""))}
                required
              />
              <p className="account-access-hint" role="status">
                {expired
                  ? "验证码已过期，请重新发送。"
                  : `有效至 ${new Date(challenge.expiresAt).toLocaleTimeString("zh-CN", { hour12: false })}`}
              </p>
            </>
          ) : (
            <>
              <label htmlFor="account-email">邮箱</label>
              <input
                ref={emailInput}
                id="account-email"
                type="email"
                autoComplete="email"
                placeholder="请输入邮箱"
                value={email}
                disabled={login.isPending}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              <p className="account-access-hint">首次验证后自动创建账号。</p>
            </>
          )}
          {login.error ? (
            <p className="account-access-error" role="alert">
              {loginError(login.error)}
            </p>
          ) : null}
          <button
            type="submit"
            className="account-access-primary"
            disabled={login.isPending || (challenge ? code.length !== 6 || expired : !email.trim())}
          >
            {login.isPending ? "正在处理…" : challenge ? "验证并登录" : "发送验证码"}
          </button>
          {challenge ? (
            <div className="account-access-secondary">
              <button
                type="button"
                className="account-access-link"
                disabled={login.isPending}
                onClick={() => submit("request")}
              >
                重新发送验证码
              </button>
              <button
                type="button"
                className="account-access-link"
                disabled={login.isPending}
                onClick={() => {
                  setChallenge(null);
                  setCode("");
                  login.reset();
                  window.requestAnimationFrame(() => emailInput.current?.focus());
                }}
              >
                更换邮箱
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
    </AccountAccessFrame>
  );
}
