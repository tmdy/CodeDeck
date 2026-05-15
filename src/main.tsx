import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found.");
}

// 先给用户一个立即可见的静态启动屏，避免等待 App bundle 时出现空白窗口。
rootElement.innerHTML = `
  <div class="startup-screen">
    <div class="unlock-card">
      <h1>Skills Manager</h1>
      <p>正在准备解锁界面...</p>
    </div>
  </div>`;

const appModule = import("./App.js");

void appModule.then(({ default: App }) => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
