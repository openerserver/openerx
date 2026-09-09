const status = document.querySelector("#status");
for (const action of ["pair", "authorize", "disconnect"])
  document.querySelector(`#${action}`).addEventListener("click", async () => {
    const button = document.querySelector(`#${action}`);
    button.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({
        action,
        ...(action === "pair" ? { code: document.querySelector("#code").value } : {}),
      });
      status.textContent =
        result.error ||
        (action === "authorize"
          ? `已授权 ${result.origin}`
          : action === "pair"
            ? "已配对，请授权当前标签页"
            : "已断开");
      if (!result.error) document.querySelector("#code").value = "";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
chrome.runtime.sendMessage({ action: "status" }).then((value) => {
  status.textContent = value.connected ? `已连接 · ${value.authorized} 个授权标签页` : "尚未连接";
});
