import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found.");
}

const appModule = window.location.hash.includes("/unlock")
  ? import("./UnlockApp.js")
  : import("./App.js");

void appModule.then(({ default: App }) => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
