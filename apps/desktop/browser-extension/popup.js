const status = document.querySelector("#status");
for (const action of ["pair", "stop", "disconnect"])
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
        (action === "stop"
          ? "已停止所有标签页操作"
          : action === "pair"
            ? "已连接，无需逐页授权"
            : "已断开");
      if (!result.error) document.querySelector("#code").value = "";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
chrome.runtime.sendMessage({ action: "status" }).then((value) => {
  status.textContent = value.connected ? `已连接 · ${value.authorized} 个任务标签页` : "尚未连接";
});
