const statusEl = document.getElementById("status");
const button = document.getElementById("analyze");

if (button) {
  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "REA_ANALYZE_ACTIVE_TAB" }, (response) => {
      if (!statusEl) {
        return;
      }
      if (response?.ok) {
        statusEl.textContent = "Opened analyzer with captured listing.";
      } else {
        statusEl.textContent = `Could not analyze tab: ${response?.error ?? "unknown error"}`;
      }
    });
  });
}
