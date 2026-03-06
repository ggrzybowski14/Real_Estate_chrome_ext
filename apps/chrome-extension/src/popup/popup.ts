const statusEl = document.getElementById("status");
const button = document.getElementById("analyze");

if (button) {
  button.addEventListener("click", () => {
    const startedAt = new Date().toISOString();
    const startedMs = performance.now();
    if (statusEl) {
      statusEl.textContent = `Started analyze at ${startedAt}...`;
    }
    chrome.runtime.sendMessage({ type: "REA_ANALYZE_ACTIVE_TAB" }, (response) => {
      if (!statusEl) {
        return;
      }
      const endedAt = new Date().toISOString();
      const totalMs = Math.round(performance.now() - startedMs);
      if (response?.ok) {
        const workerTotal =
          typeof response?.timings?.totalMs === "number"
            ? ` | worker: ${Math.round(response.timings.totalMs)}ms`
            : "";
        statusEl.textContent = `Opened analyzer. start=${startedAt} end=${endedAt} total=${totalMs}ms${workerTotal}`;
      } else {
        statusEl.textContent = `Could not analyze tab (start=${startedAt} end=${endedAt} total=${totalMs}ms): ${response?.error ?? "unknown error"}`;
      }
    });
  });
}
