import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(scriptDir, "browser-auth-smoke-worker.cjs");
const userDataDir = path.resolve("app-data", "electron-auth-smoke-user-data");

function handleRequest(request, response) {
  const origin = `http://${request.headers.host}`;
  const cookie = request.headers.cookie ?? "";
  if (request.url === "/storage") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>CodeDeck browser storage smoke</title>");
    return;
  }
  if (request.url === "/service-worker.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
    });
    response.end("self.addEventListener('fetch', () => undefined);");
    return;
  }
  if (request.url === "/api/user/auth/refresh" && request.method === "POST") {
    if (request.headers.origin !== origin || !cookie.includes("new_api_refresh=initial")) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ success: false, code: "AUTH_ORIGIN_INVALID" }));
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": "new_api_refresh=rotated; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600",
    });
    response.end(JSON.stringify({
      success: true,
      data: {
        access_token: "memory-only-smoke-bearer",
        token_type: "Bearer",
        access_expires_at: Math.floor(Date.now() / 1000) + 900,
        session: { sid: "smoke-sid" },
      },
    }));
    return;
  }
  if (request.url === "/api/user/self" && request.method === "GET") {
    const ok = cookie.includes("new_api_refresh=rotated");
    response.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
    response.end(JSON.stringify(ok
      ? { success: true, data: { id: 42 } }
      : { success: false, message: "not logged in" }));
    return;
  }
  response.writeHead(404);
  response.end();
}

const accountServer = createServer(handleRequest);
const oauthServer = createServer(handleRequest);

function runWorker(phase, baseUrl, oauthOrigin) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronExecutable, [
      workerPath,
      "--",
      phase,
      baseUrl,
      oauthOrigin,
      userDataDir,
    ], { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        let detail = "";
        try {
          detail = `\n${readFileSync(path.join(userDataDir, "smoke-error.log"), "utf8")}`;
        } catch {
          // The process may fail before the worker initializes its diagnostics.
        }
        reject(new Error(`Electron auth smoke ${phase} failed with exit code ${code}${detail}`));
      }
    });
  });
}

accountServer.listen(0, "127.0.0.1", () => {
  oauthServer.listen(0, "127.0.0.1", async () => {
    const accountAddress = accountServer.address();
    const oauthAddress = oauthServer.address();
    if (
      !accountAddress
      || typeof accountAddress === "string"
      || !oauthAddress
      || typeof oauthAddress === "string"
    ) {
      accountServer.close();
      oauthServer.close();
      throw new Error("Failed to bind auth smoke fixture");
    }
    const baseUrl = `http://127.0.0.1:${accountAddress.port}`;
    const oauthOrigin = `http://127.0.0.1:${oauthAddress.port}`;
    try {
      await runWorker("write", baseUrl, oauthOrigin);
      await runWorker("read", baseUrl, oauthOrigin);
      await runWorker("verify-cleared", baseUrl, oauthOrigin);
      console.log("Electron browser-auth smoke passed");
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      accountServer.close();
      oauthServer.close();
    }
  });
  oauthServer.once("error", (error) => {
    accountServer.close();
    console.error(error);
    process.exitCode = 1;
  });
});
accountServer.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
