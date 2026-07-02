import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found.");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createStartupShell(message: string, options: { progress?: boolean } = {}): string {
  const showProgress = options.progress ?? true;
  return `
  <div class="startup-screen">
    <div class="unlock-card">
      <h1>Skills Manager</h1>
      <p>${escapeHtml(message)}</p>
      ${showProgress ? `
      <div class="startup-progress" role="progressbar" aria-label="${escapeHtml(message)}">
        <span class="startup-progress-bar"></span>
      </div>` : ""}
    </div>
  </div>`;
}

// index.html 已经内联首屏；这里保持同结构，覆盖 dev/hmr 场景下的空 root。
rootElement.innerHTML = createStartupShell("正在准备解锁界面...");

void import("./App")
  .then(({ default: App }) => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((error) => {
    console.error("Failed to bootstrap App module.", error);
    const reason = error instanceof Error ? error.message : "未知错误";
    rootElement.innerHTML = createStartupShell(
      `界面启动失败：${reason}。请打开 DevTools 查看控制台错误（Ctrl+Shift+I）`,
      { progress: false },
    );
  });
