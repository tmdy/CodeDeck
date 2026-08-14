const { app, BrowserWindow, session } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const [phase, baseUrl, oauthOrigin, userDataDir] = process.argv.slice(-4);
const partition = "persist:codedeck-browser-auth-smoke";
const storageMarker = "codedeck-browser-storage-marker";

app.disableHardwareAcceleration();
app.on("window-all-closed", () => undefined);
mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

function writeDiagnostic(error) {
  try {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(
      path.join(userDataDir, "smoke-error.log"),
      error instanceof Error ? error.stack ?? error.message : String(error),
      "utf8",
    );
  } catch {
    // Keep the original smoke failure as the process result.
  }
}

async function withStorageWindow(origin, callback) {
  const browserWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await browserWindow.loadURL(`${origin}/storage`);
    return await callback(browserWindow);
  } finally {
    if (!browserWindow.isDestroyed()) browserWindow.destroy();
  }
}

async function writeWebStorage(origin, marker) {
  await withStorageWindow(origin, async (browserWindow) => {
    const result = await browserWindow.webContents.executeJavaScript(`(async () => {
      const marker = ${JSON.stringify(marker)};
      localStorage.setItem("codedeck-smoke", marker);
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("codedeck-smoke", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("state");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("state", "readwrite");
          transaction.objectStore("state").put(marker, "marker");
          transaction.oncomplete = () => { request.result.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
      const cache = await caches.open("codedeck-smoke");
      await cache.put("/codedeck-smoke-marker", new Response(marker));
      await navigator.serviceWorker.register("/service-worker.js");
      await navigator.serviceWorker.ready;
      return true;
    })()`);
    if (result !== true) throw new Error(`failed to write browser storage for ${origin}`);
  });
}

async function readWebStorage(origin) {
  return withStorageWindow(origin, (browserWindow) => browserWindow.webContents.executeJavaScript(`(async () => {
    const local = localStorage.getItem("codedeck-smoke");
    const indexed = await new Promise((resolve, reject) => {
      const request = indexedDB.open("codedeck-smoke", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("state", "readonly");
        const getRequest = transaction.objectStore("state").get("marker");
        getRequest.onsuccess = () => { request.result.close(); resolve(getRequest.result ?? null); };
        getRequest.onerror = () => reject(getRequest.error);
      };
    });
    const cached = await (await caches.open("codedeck-smoke")).match("/codedeck-smoke-marker");
    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      local,
      indexed,
      cached: cached ? await cached.text() : null,
      serviceWorkerCount: registrations.length,
    };
  })()`));
}

function assertStoredState(origin, actual, expected) {
  if (
    actual.local !== expected
    || actual.indexed !== expected
    || actual.cached !== expected
    || actual.serviceWorkerCount < 1
  ) {
    throw new Error(`persistent browser storage failed for ${origin}: ${JSON.stringify(actual)}`);
  }
}

function assertClearedState(origin, actual) {
  if (
    actual.local !== null
    || actual.indexed !== null
    || actual.cached !== null
    || actual.serviceWorkerCount !== 0
  ) {
    throw new Error(`browser storage cleanup failed for ${origin}: ${JSON.stringify(actual)}`);
  }
}

app.whenReady().then(async () => {
  const browserSession = session.fromPartition(partition, { cache: false });
  try {
    if (phase === "write") {
      await browserSession.clearStorageData();
      await browserSession.clearCache();
      await browserSession.cookies.set({
        url: `${baseUrl}/`,
        name: "new_api_refresh",
        value: "initial",
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        expirationDate: Math.floor(Date.now() / 1000) + 3600,
      });
      const refresh = await browserSession.fetch(`${baseUrl}/api/user/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: baseUrl,
        },
        body: "{}",
      });
      if (!refresh.ok) throw new Error(`refresh failed: ${refresh.status}`);
      await refresh.text();
      await browserSession.cookies.flushStore();
      await writeWebStorage(baseUrl, `${storageMarker}:account`);
      await writeWebStorage(oauthOrigin, `${storageMarker}:linuxdo`);
    } else if (phase === "read") {
      const legacy = await browserSession.fetch(`${baseUrl}/api/user/self`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const payload = await legacy.json();
      if (!legacy.ok || payload?.data?.id !== 42) {
        throw new Error(`persistent legacy cookie attachment failed: ${legacy.status}`);
      }
      assertStoredState(baseUrl, await readWebStorage(baseUrl), `${storageMarker}:account`);
      assertStoredState(oauthOrigin, await readWebStorage(oauthOrigin), `${storageMarker}:linuxdo`);
      await browserSession.clearStorageData();
      await browserSession.clearCache();
      await browserSession.cookies.flushStore();
    } else if (phase === "verify-cleared") {
      const legacy = await browserSession.fetch(`${baseUrl}/api/user/self`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (legacy.status !== 401) {
        throw new Error(`browser cookie cleanup failed: ${legacy.status}`);
      }
      assertClearedState(baseUrl, await readWebStorage(baseUrl));
      assertClearedState(oauthOrigin, await readWebStorage(oauthOrigin));
    } else {
      throw new Error(`unknown smoke phase: ${phase}`);
    }
    app.exit(0);
  } catch (error) {
    writeDiagnostic(error);
    console.error(error);
    app.exit(1);
  }
});
