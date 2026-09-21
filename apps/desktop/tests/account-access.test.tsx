// @vitest-environment jsdom
import type { AccountState, DesktopBridge } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountAccess } from "../src/renderer/AccountAccess";

const signedOut: AccountState = {
  status: "signed_out",
  account: null,
  session: null,
  reason: null,
};
function setup(state: AccountState = signedOut, error: Error | null = null) {
  const requestEmailCode = vi.fn(async ({ email }: { email: string }) => ({
    challengeId: crypto.randomUUID(),
    email,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }));
  const verifyEmailCode = vi.fn().mockResolvedValue({ ...signedOut, status: "signed_in" });
  window.openerx = { requestEmailCode, verifyEmailCode } as unknown as DesktopBridge;
  const onContinue = vi.fn();
  const onConfigureModel = vi.fn();
  const onSignedIn = vi.fn();
  const onRetry = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <AccountAccess
        state={state}
        loading={false}
        error={error}
        onContinue={onContinue}
        onConfigureModel={onConfigureModel}
        onSignedIn={onSignedIn}
        onRetry={onRetry}
      />
    </QueryClientProvider>,
  );
  return {
    requestEmailCode,
    verifyEmailCode,
    onContinue,
    onConfigureModel,
    onSignedIn,
    onRetry,
    user: userEvent.setup(),
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("account access", () => {
  it("keeps local use and model setup available without an account service", async () => {
    const context = setup({
      ...signedOut,
      status: "unavailable",
      reason: "PLATFORM_ENDPOINT_NOT_CONFIGURED",
    });
    expect(screen.getByRole("heading", { name: "欢迎使用 openerx" })).toBeTruthy();
    expect(screen.queryByLabelText("邮箱")).toBeNull();
    expect(screen.queryByRole("button", { name: "发送验证码" })).toBeNull();
    await context.user.click(screen.getByRole("button", { name: "直接使用" }));
    await context.user.click(screen.getByRole("button", { name: "配置自有 API Key 或本地模型" }));
    expect(context.onContinue).toHaveBeenCalledOnce();
    expect(context.onConfigureModel).toHaveBeenCalledOnce();
    expect(context.requestEmailCode).not.toHaveBeenCalled();
    expect(context.verifyEmailCode).not.toHaveBeenCalled();
  });

  it("requests a code, permits correction after rejection, and signs in with the visible code", async () => {
    const context = setup();
    context.verifyEmailCode.mockRejectedValueOnce(new Error("CHALLENGE_CODE_INVALID"));
    await context.user.type(screen.getByLabelText("邮箱"), "person@example.com");
    await context.user.click(screen.getByRole("button", { name: "发送验证码" }));
    const code = await screen.findByLabelText("六位验证码");
    expect(context.requestEmailCode).toHaveBeenCalledWith({ email: "person@example.com" });
    expect(document.activeElement).toBe(code);
    expect(screen.queryByLabelText("邮箱")).toBeNull();
    await context.user.type(code, "000000");
    await context.user.click(screen.getByRole("button", { name: "验证并登录" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "验证码不正确，请检查后重试。",
    );
    // Model the native OTP autofill value before React receives its input event.
    (code as HTMLInputElement).value = "123456";
    fireEvent.submit(screen.getByRole("form", { name: "验证码登录" }));
    await waitFor(() => expect(context.onSignedIn).toHaveBeenCalledOnce());
    expect(context.verifyEmailCode).toHaveBeenLastCalledWith({
      challengeId: expect.any(String),
      code: "123456",
    });
  });

  it("can resend an expired challenge and change the email without stale validation errors", async () => {
    const context = setup();
    context.requestEmailCode.mockResolvedValueOnce({
      challengeId: crypto.randomUUID(),
      email: "person@example.com",
      expiresAt: "2000-01-01T00:00:00Z",
    });
    await context.user.type(screen.getByLabelText("邮箱"), "person@example.com");
    await context.user.click(screen.getByRole("button", { name: "发送验证码" }));
    expect(await screen.findByText("验证码已过期，请重新发送。")).toBeTruthy();
    expect((screen.getByLabelText("六位验证码") as HTMLInputElement).disabled).toBe(true);
    await context.user.click(screen.getByRole("button", { name: "重新发送验证码" }));
    await waitFor(() =>
      expect((screen.getByLabelText("六位验证码") as HTMLInputElement).disabled).toBe(false),
    );
    expect(context.requestEmailCode).toHaveBeenCalledTimes(2);
    await context.user.click(screen.getByRole("button", { name: "更换邮箱" }));
    expect(screen.getByLabelText("邮箱")).toHaveProperty("value", "person@example.com");
    expect(screen.queryByLabelText("六位验证码")).toBeNull();
    await context.user.clear(screen.getByLabelText("邮箱"));
    await context.user.type(screen.getByLabelText("邮箱"), "another@example.com");
    await context.user.click(screen.getByRole("button", { name: "发送验证码" }));
    await screen.findByLabelText("六位验证码");
    expect(context.requestEmailCode).toHaveBeenLastCalledWith({ email: "another@example.com" });
  });

  it("prevents duplicate submissions while keeping local access available", async () => {
    const context = setup();
    let resolve:
      | ((value: Awaited<ReturnType<typeof context.requestEmailCode>>) => void)
      | undefined;
    context.requestEmailCode.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await context.user.type(screen.getByLabelText("邮箱"), "person@example.com");
    const form = screen.getByRole("form", { name: "邮箱登录" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(context.requestEmailCode).toHaveBeenCalledOnce());
    await context.user.click(screen.getByRole("button", { name: "直接使用" }));
    expect(context.onContinue).toHaveBeenCalledOnce();
    resolve?.({
      challengeId: crypto.randomUUID(),
      email: "person@example.com",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    await screen.findByLabelText("六位验证码");
  });

  it("offers reconnection after state lookup fails and never exposes internal errors", async () => {
    const context = setup(signedOut, new Error("private endpoint details"));
    expect(screen.getByRole("alert").textContent).not.toContain("private endpoint");
    expect(screen.queryByLabelText("邮箱")).toBeNull();
    await context.user.click(screen.getByRole("button", { name: "重新连接" }));
    expect(context.onRetry).toHaveBeenCalledOnce();
  });
});
