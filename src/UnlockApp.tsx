import { useEffect, useState } from "react";
import { APP_NAME } from "./shared/branding.js";

function preloadMainApp(): () => void {
  let cancelled = false;
  const preload = () => {
    if (!cancelled) {
      void import("./App.js");
    }
  };

  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(preload, { timeout: 1000 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback(handle);
    };
  }

  const handle = window.setTimeout(preload, 0);
  return () => {
    cancelled = true;
    window.clearTimeout(handle);
  };
}

export default function UnlockApp() {
  const [hasEncryptedConfig, setHasEncryptedConfig] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("unlock-route");
    return () => {
      document.body.classList.remove("unlock-route");
    };
  }, []);

  useEffect(() => {
    return preloadMainApp();
  }, []);

  useEffect(() => {
    if (!window.profileManager) {
      setUnlockError("当前环境未注入 Profile API，请通过 Electron 运行。");
      return;
    }

    let cancelled = false;
    void window.profileManager.checkEncryptedConfig()
      .then((hasConfig) => {
        if (!cancelled) {
          setHasEncryptedConfig(hasConfig);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUnlockError(err instanceof Error ? err.message : "初始化失败");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.profileManager) return;
    return window.profileManager.onUnlockError((message) => {
      setUnlockError(message);
      setIsBusy(false);
    });
  }, []);

  async function handleUnlock() {
    if (!window.profileManager) {
      setUnlockError("当前环境未注入 Profile API，请通过 Electron 运行。");
      return;
    }

    setIsBusy(true);
    setUnlockError(null);
    try {
      await window.profileManager.unlock(passphrase);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "解锁失败");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="unlock-screen">
      <div className="unlock-card">
        <h1>{APP_NAME}</h1>
        <input
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleUnlock();
            }
          }}
          placeholder="输入密码"
          autoFocus
          disabled={isBusy}
        />
        <button type="button" onClick={() => void handleUnlock()} disabled={isBusy || !passphrase}>
          {hasEncryptedConfig ? "解锁" : "创建并进入"}
        </button>
        {unlockError && <div className="banner error">{unlockError}</div>}
      </div>
    </div>
  );
}
