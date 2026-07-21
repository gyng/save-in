import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { expect } from "vitest";

import {
  CONTENT_DISPOSITION_CASES,
  startContentDispositionServer,
} from "./content-disposition-cases.mjs";
import {
  arrayOf,
  closeLocal,
  decodeNumber,
  decodeRecord,
  decodeString,
  evaluateJson,
  listenLocal,
  objectOf,
  requireValue,
  waitForPageCondition,
} from "./helpers.mjs";
/** @typedef {import("./control-protocol.mjs").DownloadSummary} DownloadSummary */
/** @typedef {import("./control-protocol.mjs").LogEntry} LogEntry */

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   downloadUsingBrowserFilename: (url: string) => Promise<string>,
 *   waitForDownloadUrl: (url: string) => Promise<string>,
 * }} adapters
 */
export const runContentDispositionScenario = async ({
  control,
  downloadUsingBrowserFilename,
  waitForDownloadUrl,
}) => {
  const { server, port } = await startContentDispositionServer();
  try {
    for (const fixture of CONTENT_DISPOSITION_CASES) {
      const nativeUrl = `http://127.0.0.1:${port}/${fixture.id}?source=native`;
      const saveInUrl = `http://127.0.0.1:${port}/${fixture.id}?source=save-in`;
      const nativeFilename = await downloadUsingBrowserFilename(nativeUrl);
      await control.background.startDownload({
        url: saveInUrl,
        suggestedFilename: `${fixture.id}-url-fallback.bin`,
        pageUrl: `http://127.0.0.1:${port}/`,
        path: "e2e/content-disposition",
      });
      expect.soft(await waitForDownloadUrl(saveInUrl), fixture.id).toBe(nativeFilename);
    }
  } finally {
    await closeLocal(server);
  }
};

/**
 * Drives private context-menu and Last used saves through the production
 * pipeline while verifying the default private-isolation policy.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   filename: string,
 *   privateWindowId?: number,
 *   persistActivity?: boolean,
 * }} adapters
 */
export const runPrivateContextScenario = async ({
  control,
  waitForDownloads,
  filename,
  privateWindowId,
  persistActivity = false,
}) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("private context content");
  });
  const port = await listenLocal(server);
  const privateUrl = `http://127.0.0.1:${port}/${filename}.txt`;
  const repeatedName = `last-used-${filename}`;
  const [local, session, log, history] = await Promise.all([
    control.storage.local.get([
      "paths",
      "persistPrivateActivity",
      "lastUsedPath",
      "lastUsedMeta",
      "recentDestinations",
    ]),
    control.storage.session.get(),
    control.logs.get(),
    control.history.get(),
  ]);
  const snapshot = { local, session, log, history };

  try {
    await control.options.set({ paths: "e2e/private", persistPrivateActivity: persistActivity });
    await control.background.clickContextMenu({
      info: {
        menuItemId: "save-in-0",
        mediaType: "image",
        srcUrl: privateUrl,
        pageUrl: "https://private.example/",
      },
      tab: {
        id: 91,
        ...(privateWindowId === undefined ? {} : { windowId: privateWindowId }),
        title: filename,
        url: "https://private.example/",
        incognito: true,
      },
    });

    const downloads = await waitForDownloads(filename);
    expect(downloads).toHaveLength(1);
    const completed = requireValue(downloads[0], "Private-context download was not captured");
    expect(completed.state).toBe("complete");
    expect(fs.readFileSync(completed.filename, "utf8")).toBe("private context content");

    // Force the same session hydration used after an idle event page or worker
    // restart before exercising the private Last used destination.
    await control.runtime.reset();
    await control.background.clickContextMenu({
      info: {
        menuItemId: "save-in-last-used",
        mediaType: "image",
        srcUrl: `http://127.0.0.1:${port}/${repeatedName}.txt`,
        pageUrl: "https://private.example/",
      },
      tab: {
        id: 91,
        ...(privateWindowId === undefined ? {} : { windowId: privateWindowId }),
        title: repeatedName,
        url: "https://private.example/",
        incognito: true,
      },
    });
    const repeatedDownloads = await waitForDownloads(repeatedName);
    expect(repeatedDownloads).toHaveLength(1);
    const repeated = requireValue(repeatedDownloads[0], "Private Last used save was not captured");
    expect(repeated.state).toBe("complete");
    expect(repeated.filename).toMatch(new RegExp(`e2e[\\\\/]private[\\\\/]${repeatedName}\\.txt$`));

    const [afterLocal, afterSession, afterLog, afterHistory] = await Promise.all([
      control.storage.local.get(["lastUsedPath", "lastUsedMeta", "recentDestinations"]),
      control.storage.session.get(),
      control.logs.get(),
      control.history.get(),
    ]);
    const after = {
      local: afterLocal,
      session: afterSession,
      log: afterLog,
      history: afterHistory,
    };
    if (persistActivity) {
      expect(after.local.lastUsedPath).toBe("e2e/private");
      expect(after.local.lastUsedMeta).toEqual(expect.objectContaining({ title: "e2e/private" }));
      expect(after.local.recentDestinations).toEqual([
        expect.objectContaining({ path: "e2e/private" }),
      ]);
      const newHistory = after.history.slice(snapshot.history.length);
      expect(newHistory).toHaveLength(2);
      expect(newHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ private: true, url: privateUrl }),
          expect.objectContaining({
            private: true,
            url: `http://127.0.0.1:${port}/${repeatedName}.txt`,
          }),
        ]),
      );
      expect(after.log.length).toBeGreaterThan(snapshot.log.length);
      expect(after.session.siPrivateLastUsed).toBeUndefined();
      expect(Object.values(after.session.siDownloads || {})).toEqual(
        expect.arrayContaining([expect.objectContaining({ privateContext: true })]),
      );
    } else {
      expect(after.history).toEqual(snapshot.history);
      expect(after.local.lastUsedPath).toEqual(snapshot.local.lastUsedPath);
      expect(after.local.lastUsedMeta).toEqual(snapshot.local.lastUsedMeta);
      expect(after.local.recentDestinations).toEqual(snapshot.local.recentDestinations);
      expect(after.log).toEqual(snapshot.log);
      expect(after.session.siPrivateLastUsed).toEqual({
        path: "e2e/private",
        meta: expect.objectContaining({ title: "e2e/private" }),
      });
      expect(Object.keys(after.session.siDownloads || {})).toHaveLength(0);
    }
    expect(after.session.siPrivatePendingDownloads ?? 0).toBe(0);
    expect(Object.keys(after.session.siActiveTransfers || {})).toHaveLength(0);
  } finally {
    const hadPaths = Object.hasOwn(snapshot.local, "paths");
    const hadPersistence = Object.hasOwn(snapshot.local, "persistPrivateActivity");
    try {
      if (hadPaths) await control.storage.local.set({ paths: snapshot.local.paths });
      else await control.storage.local.remove("paths");
      if (hadPersistence) {
        await control.storage.local.set({
          persistPrivateActivity: snapshot.local.persistPrivateActivity,
        });
      } else await control.storage.local.remove("persistPrivateActivity");
      await control.runtime.reset();
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * Exercises content-script and browser-owned activity in a real private
 * window: an ordinary download must remain untouched, automatic saving must
 * honor its private opt-in, and neither path may enter extension persistence.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   openPrivatePage: (url: string) => Promise<{tabId: number, target: string, close: () => Promise<void>}>,
 *   evaluatePrivatePage: (target: string, expression: string, timeoutMs?: number) => Promise<unknown>,
 *   waitForFile: (relativePath: string) => Promise<string>,
 *   filenamePrefix: string,
 * }} adapters
 */
export const runPrivateBrowserActivityScenario = async ({
  control,
  openPrivatePage,
  evaluatePrivatePage,
  waitForFile,
  filenamePrefix,
}) => {
  const nativeName = `${filenamePrefix}-native.bin`;
  const initialName = `${filenamePrefix}-initial.png`;
  const lateName = `${filenamePrefix}-late.png`;
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  /** @type {(() => void) | undefined} */
  let nativeRequestResolve;
  /** @type {Promise<void>} */
  const nativeRequest = new Promise((resolve) => {
    nativeRequestResolve = () => resolve();
  });
  const server = http.createServer((req, res) => {
    if (req.url === `/${nativeName}`) {
      nativeRequestResolve?.();
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${nativeName}"`,
      });
      res.end("private ordinary content");
      return;
    }
    if (req.url?.endsWith(".png")) {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": image.length });
      res.end(image);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>Private E2E</title>
      <a id="native" href="/${nativeName}">ordinary private download</a>
      <img id="initial" src="/${initialName}" alt="initial private source">`);
  });
  const port = await listenLocal(server);
  const target = `127.0.0.1:${port}/private-browser`;
  const pageUrl = `http://${target}`;
  const optionKeys = [
    "trackBrowserDownloads",
    "routeBrowserDownloads",
    "routeBrowserDownloadsFirefox",
    "browserDownloadFilter",
    "autoDownloadEnabled",
    "autoDownloadLive",
    "autoDownloadPrivate",
    "autoDownloadMaxPerPage",
    "sourcePanelEnabled",
    "filenamePatterns",
  ];
  const [options, history, log] = await Promise.all([
    control.storage.local.get(optionKeys),
    control.history.get(),
    control.logs.get(),
  ]);
  const before = { options, history, log };
  const missingKeys = optionKeys.filter((key) => !(key in before.options));
  /** @type {{tabId: number, target: string, close: () => Promise<void>} | undefined} */
  let privatePage;

  try {
    await control.options.set({
      trackBrowserDownloads: true,
      routeBrowserDownloads: true,
      routeBrowserDownloadsFirefox: true,
      browserDownloadFilter: "*://127.0.0.1/*",
      autoDownloadEnabled: true,
      autoDownloadLive: true,
      autoDownloadPrivate: false,
      autoDownloadMaxPerPage: 2,
      sourcePanelEnabled: true,
      filenamePatterns: `context: ^browser$
sourceurl: ${filenamePrefix}-native\\.bin$
into: e2e/private-ordinary-should-not-route/:filename:

context: ^auto$
pageurl: ^http://127\\.0\\.0\\.1:${port}/private-browser$
sourcekind: ^image$
sourceurl: ${filenamePrefix}-(?:initial|late)\\.png$
into: e2e/private-auto/:filename:`,
    });
    // The content script announces readiness and the background immediately
    // restores this session value. Make that restore agree with the explicit
    // open below; otherwise its queued `open: false` can overtake the test's
    // message on a slow Firefox launch and close a panel that was just opened.
    await control.storage.session.set({ sourcePanelOpen: true });
    privatePage = await openPrivatePage(pageUrl);
    await control.tabs.sendMessage(privatePage.tabId, {
      type: "SET_SOURCE_PANEL",
      body: { open: true },
    });
    const privateTarget = privatePage.target;
    await waitForPageCondition(
      (expression, timeoutMs) => evaluatePrivatePage(privateTarget, expression, timeoutMs),
      `Boolean(document.querySelector("#save-in-source-panel")?.shadowRoot)`,
      { description: "private content script" },
    );
    const beforeOptIn = (await control.downloads.search()).filter(
      (item) => item.url === `http://127.0.0.1:${port}/${initialName}`,
    );
    expect(beforeOptIn).toHaveLength(0);

    await evaluatePrivatePage(privatePage.target, `document.querySelector("#native").click()`);
    await new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(8000);
      timeout.addEventListener(
        "abort",
        () => reject(new Error("Private ordinary download request did not start")),
        { once: true },
      );
      nativeRequest.then(resolve, reject);
    });

    // Reset acknowledgement makes the background observe the opt-in before
    // a fresh private document discovers its initial candidates.
    await control.options.set({ autoDownloadPrivate: true });
    await control.tabs.reload(privatePage.tabId);
    await control.tabs.wait({ id: privatePage.tabId });
    await evaluatePrivatePage(
      privatePage.target,
      `(() => {
        const image = document.createElement("img");
        image.src = "/${lateName}";
        document.body.append(image);
        return true;
      })()`,
    );
    const initialPath = await waitForFile(path.join("e2e", "private-auto", initialName));
    const latePath = await waitForFile(path.join("e2e", "private-auto", lateName));
    expect(fs.readFileSync(initialPath)).toEqual(image);
    expect(fs.readFileSync(latePath)).toEqual(image);

    const [afterHistory, afterLog] = await Promise.all([control.history.get(), control.logs.get()]);
    const after = { history: afterHistory, log: afterLog };
    const privateNames = [nativeName, initialName, lateName];
    expect(
      after.history.filter((entry) =>
        privateNames.some((name) => JSON.stringify(entry).includes(name)),
      ),
    ).toEqual([]);
    expect(
      after.log.filter((entry) =>
        privateNames.some((name) => JSON.stringify(entry).includes(name)),
      ),
    ).toEqual([]);
  } finally {
    try {
      await privatePage?.close();
      await Promise.all([
        control.storage.session.set({ sourcePanelOpen: false }),
        control.storage.local.set(before.options),
        control.storage.local.remove(missingKeys),
      ]);
      await control.runtime.reset();
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * Uses a separately installed extension to exercise the real external-message
 * boundary, including browser-authenticated sender authorization.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   sendExternal: (message: Record<string, unknown>) => Promise<unknown>,
 *   callerId: string,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   filename: string,
 * }} adapters
 */
export const runExternalExtensionScenario = async ({
  control,
  sendExternal,
  callerId,
  waitForDownloads,
  filename,
}) => {
  const body = `external extension content: ${filename}`;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(body);
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const optionKeys = ["externalDownloadAllowlist", "filenamePatterns"];
  const previous = await control.storage.local.get(optionKeys);
  const missingKeys = optionKeys.filter((key) => !(key in previous));

  try {
    const pong = objectOf({
      type: decodeString,
      body: objectOf({ version: decodeNumber, capabilities: arrayOf(decodeString) }),
    })(await sendExternal({ type: "PING" }));
    expect(pong).toMatchObject({ type: "PONG", body: { version: 1 } });
    expect(pong.body.capabilities).toContain("download");

    const unauthorized = await sendExternal({
      type: "DOWNLOAD",
      body: { url, info: { suggestedFilename: filename } },
    });
    expect(unauthorized).toMatchObject({
      type: "DOWNLOAD",
      body: { status: "ERROR", error: "UNAUTHORIZED", version: 1 },
    });
    const rejectionResponse = await control.runtime.send({
      type: "EXTERNAL_DOWNLOAD_REJECTIONS_GET",
    });
    const rejection = rejectionResponse.body.rejections.find(
      (entry) => entry.senderId === callerId,
    );
    expect(rejection).toMatchObject({ senderId: callerId, attempts: 1 });

    await control.options.set({
      externalDownloadAllowlist: callerId,
      filenamePatterns: "comment: ^external-e2e$\ninto: e2e/external/:filename:",
    });
    const accepted = await sendExternal({
      type: "DOWNLOAD",
      body: {
        url,
        comment: "external-e2e",
        info: { suggestedFilename: filename, pageUrl: "https://caller.example/" },
      },
    });
    expect(accepted).toEqual({
      type: "DOWNLOAD",
      body: { status: "OK", version: 1, url },
    });
    const downloads = await waitForDownloads(filename);
    const complete = requireValue(
      downloads.find((row) => row.state === "complete"),
      "External-extension download did not complete",
    );
    expect(complete.filename).toMatch(/e2e[\\/]external[\\/]/);
    expect(fs.readFileSync(complete.filename, "utf8")).toBe(body);
  } finally {
    try {
      await Promise.all([
        control.storage.local.set(previous),
        control.storage.local.remove(missingKeys),
        control.runtime.send({
          type: "EXTERNAL_DOWNLOAD_REJECTION_CLEAR",
          body: { senderId: callerId },
        }),
      ]);
      await control.runtime.reset();
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * Cancels a real stalled acquisition through the History protocol and proves
 * that both the network request and durable transfer state are released.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   evaluate: (expression: string) => Promise<unknown>,
 *   filename: string,
 * }} adapters
 */
export const runHistoryCancellationScenario = async ({ control, evaluate, filename }) => {
  /** @type {import("node:http").ServerResponse | undefined} */
  let pendingResponse;
  /** @type {(() => void) | undefined} */
  let requestStartedResolve;
  /** @type {(() => void) | undefined} */
  let requestClosedResolve;
  /** @type {Promise<void>} */
  const requestStarted = new Promise((resolve) => {
    requestStartedResolve = () => resolve();
  });
  /** @type {Promise<void>} */
  const requestClosed = new Promise((resolve) => {
    requestClosedResolve = () => resolve();
  });
  const server = http.createServer((req, res) => {
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": "1024",
      });
      res.end();
      return;
    }
    pendingResponse = res;
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": "1024",
    });
    res.flushHeaders();
    res.once("close", () => requestClosedResolve?.());
    requestStartedResolve?.();
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const optionKeys = ["fetchViaFetch", "filenamePatterns"];
  const previous = await control.storage.local.get(optionKeys);
  const missingKeys = optionKeys.filter((key) => !Object.hasOwn(previous, key));

  try {
    await evaluate(`api.setOptions({ fetchViaFetch: true, filenamePatterns: "" })
      .then(() => { void api.startDownload({
        url: ${JSON.stringify(url)},
        suggestedFilename: ${JSON.stringify(filename)},
        pageUrl: "https://cancel.example/",
      }); return "started"; })`);
    await requestStarted;
    const historyId = decodeString(
      await evaluate(`new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(8000);
      const check = async () => {
        const entry = (await api.history()).findLast((row) => row.url === ${JSON.stringify(url)});
        const active = await browser.storage.session.get("siActiveTransfers");
        if (entry?.status === "pending" && active.siActiveTransfers?.[entry.id]) {
          resolve(entry.id);
          return;
        }
        if (timeout.aborted) {
          reject(new Error("Timed out waiting for cancellable History entry"));
          return;
        }
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          void check();
        };
        channel.port2.postMessage(null);
      };
      void check();
    })`),
    );
    const response = await control.runtime.send({
      type: "HISTORY_CANCEL",
      body: { historyId },
    });
    expect(response).toEqual({ type: "HISTORY_CANCEL", body: { canceled: true } });
    /** @type {Promise<void>} */
    const requestClosedWithinDeadline = new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(8000);
      timeout.addEventListener(
        "abort",
        () => reject(new Error("Canceled History request did not close")),
        { once: true },
      );
      requestClosed.then(resolve, reject);
    });
    await requestClosedWithinDeadline;

    const terminal = await evaluateJson(
      evaluate,
      `new Promise((resolve, reject) => {
        const timeout = AbortSignal.timeout(8000);
        const check = async () => {
          const [history, session, downloads] = await Promise.all([
            api.history(),
            browser.storage.session.get("siActiveTransfers"),
            browser.downloads.search({}),
          ]);
          const entry = history.findLast((row) => row.id === ${JSON.stringify(historyId)});
          const matchingDownloads = downloads.filter((row) => row.url === ${JSON.stringify(url)});
          if (entry?.status === "USER_CANCELED" &&
              Object.keys(session.siActiveTransfers || {}).length === 0 &&
              matchingDownloads.length === 0) {
            resolve(JSON.stringify(entry));
            return;
          }
          if (timeout.aborted) {
            reject(new Error("Timed out waiting for History cancellation cleanup"));
            return;
          }
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            void check();
          };
          channel.port2.postMessage(null);
        };
        void check();
      })`,
      objectOf({ status: decodeString }),
    );
    expect(terminal.status).toBe("USER_CANCELED");
  } finally {
    pendingResponse?.destroy();
    await Promise.all([
      control.storage.local.set(previous),
      control.storage.local.remove(missingKeys),
    ]);
    await control.runtime.reset();
    await closeLocal(server);
  }
};

/**
 * Starts a real background fetch, restarts the background while it is in
 * flight, and verifies cold-start recovery clears the durable transfer record.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   evaluate: (expression: string) => Promise<unknown>,
 *   restartBackground: () => Promise<void>,
 *   filename: string,
 * }} adapters
 */
export const runInterruptedTransferRecoveryScenario = async ({
  control,
  evaluate,
  restartBackground,
  filename,
}) => {
  /** @type {import("node:http").ServerResponse | undefined} */
  let pendingResponse;
  /** @type {(() => void) | undefined} */
  let requestStartedResolve;
  /** @type {Promise<void>} */
  const requestStarted = new Promise((resolve) => {
    requestStartedResolve = () => resolve();
  });
  const server = http.createServer((req, res) => {
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": "1024",
      });
      res.end();
      return;
    }
    pendingResponse = res;
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": "1024",
    });
    res.flushHeaders();
    requestStartedResolve?.();
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const previousFetchViaFetch = await control.options.get("fetchViaFetch");

  try {
    await evaluate(`api.setOptions({ fetchViaFetch: true, filenamePatterns: "" })
      .then(() => { void api.startDownload({
        url: ${JSON.stringify(url)},
        suggestedFilename: ${JSON.stringify(filename)},
        pageUrl: "https://restart.example/",
      }); return "started"; })`);
    await requestStarted;
    const active = await evaluateJson(
      evaluate,
      `new Promise((resolve, reject) => {
        const timeout = AbortSignal.timeout(8000);
        let settled = false;
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          browser.storage.onChanged.removeListener(onChanged);
          timeout.removeEventListener("abort", onTimeout);
          callback();
        };
        const check = async () => {
          const stored = await browser.storage.session.get("siActiveTransfers");
          const records = stored.siActiveTransfers || {};
          if (Object.keys(records).length === 1) {
            finish(() => resolve(JSON.stringify(records)));
          }
        };
        const onChanged = (_changes, area) => {
          if (area === "session") void check().catch((error) => finish(() => reject(error)));
        };
        const onTimeout = () => finish(() => reject(
          new Error("Timed out waiting for durable active-transfer state")
        ));
        browser.storage.onChanged.addListener(onChanged);
        timeout.addEventListener("abort", onTimeout, { once: true });
        void check().catch((error) => finish(() => reject(error)));
      })`,
      decodeRecord,
    );
    expect(Object.keys(active)).toHaveLength(1);

    await restartBackground();
    pendingResponse?.end("response after background restart");

    const recovered = await evaluateJson(
      evaluate,
      `new Promise((resolve, reject) => {
        const timeout = AbortSignal.timeout(8000);
        const check = async () => {
          const [history, session] = await Promise.all([
            api.history(),
            browser.storage.session.get("siActiveTransfers"),
          ]);
          const entry = history.findLast((row) => row.url === ${JSON.stringify(url)});
          if (entry?.status === "DOWNLOAD_PREPARATION_INTERRUPTED" &&
              Object.keys(session.siActiveTransfers || {}).length === 0) {
            resolve(JSON.stringify(entry));
            return;
          }
          if (timeout.aborted) {
            reject(new Error("Timed out waiting for interrupted-transfer recovery"));
            return;
          }
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            void check();
          };
          channel.port2.postMessage(null);
        };
        void check();
      })`,
      objectOf({ status: decodeString }),
    );
    expect(recovered.status).toBe("DOWNLOAD_PREPARATION_INTERRUPTED");
  } finally {
    pendingResponse?.destroy();
    await control.options.set({ fetchViaFetch: previousFetchViaFetch });
    await closeLocal(server);
  }
};

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   content: string,
 * }} adapters
 */
export const runRoutingScenario = async ({ control, waitForDownloads, content }) => {
  await control.options.set({
    filenamePatterns: "filename: routeme\ninto: routed/renamed-:filename:",
  });
  await control.background.startDownload({
    content,
    suggestedFilename: "routeme.txt",
    pageUrl: "https://example.com/",
  });
  const downloads = await waitForDownloads("renamed-routeme");
  expect(downloads.map((entry) => entry.state)).toEqual(["complete"]);
  return downloads;
};

/**
 * Proves a rename: clause edits the final filename component of a real save:
 * the into: template expands first, then the transform rewrites the matched
 * text before the browser download starts.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   content: string,
 * }} adapters
 */
export const runRenameRoutingScenario = async ({ control, waitForDownloads, content }) => {
  await control.options.set({
    filenamePatterns:
      "filename: renameme\nrename/g: renameme -> renamed\ninto: routed/save-:filename:",
  });
  await control.background.startDownload({
    content,
    suggestedFilename: "renameme.txt",
    pageUrl: "https://example.com/",
  });
  const downloads = await waitForDownloads("save-renamed");
  expect(downloads.map((entry) => entry.state)).toEqual(["complete"]);
  return downloads;
};

/**
 * Replays the durable settings that matter most when a 3.7 profile first runs
 * version 4, then proves that an extensionless response still reaches its
 * configured folder with the MIME-derived extension.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   filename: string,
 * }} adapters
 */
export const runLegacyProfileRoutingScenario = async ({ control, waitForDownloads, filename }) => {
  const body = Buffer.from("legacy profile png");
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": body.length,
    });
    res.end(body);
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const previous = /** @type {Record<string, unknown>} */ (
    await control.storage.local.get([
      "paths",
      "filenamePatterns",
      "contentClickToSaveCombo",
      "appendMimeExtension",
    ])
  );
  const legacyKeys = [
    "paths",
    "filenamePatterns",
    "contentClickToSaveCombo",
    "appendMimeExtension",
  ];
  const missingLegacyKeys = legacyKeys.filter((key) => !(key in previous));

  try {
    await control.options.set({
      paths: "e2e/legacy-custom",
      filenamePatterns: "mime: ^image/png$\ninto: legacy-custom/:filename:",
      contentClickToSaveCombo: 18,
      // The extension repair below is what this option does, and it is off by
      // default, so the scenario has to ask for it. A legacy profile does not
      // carry the key and so does not get the repair either — that is the
      // deliberate 4.0 behavior, not something this case should assert away.
      // Only Firefox depends on the option: Save In hands downloads.download an
      // exact name there, while Chrome's downloads API infers .png from the
      // Content-Type itself and would name the file the same way regardless.
      appendMimeExtension: true,
    });
    const resolved = {
      paths: await control.options.get("paths"),
      combo: await control.options.get("contentClickToSaveCombo"),
    };
    expect(resolved).toEqual({ paths: "e2e/legacy-custom", combo: 18 });

    await control.background.startDownload({
      url,
      suggestedFilename: filename,
      pageUrl: "https://legacy-profile.example/",
    });
    const downloads = await waitForDownloads(`${filename}.png`);
    expect(downloads).toHaveLength(1);
    const completed = requireValue(downloads[0], "Legacy-profile download was not captured");
    expect(completed.state).toBe("complete");
    expect(completed.filename).toMatch(
      new RegExp(`e2e[\\\\/]legacy-custom[\\\\/]${filename}\\.png$`),
    );
    expect(fs.readFileSync(completed.filename)).toEqual(body);
  } finally {
    try {
      await Promise.all([
        control.storage.local.set(previous),
        control.storage.local.remove(missingLegacyKeys),
      ]);
      await control.runtime.reset();
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   downloadDir: string,
 *   filename: string,
 *   supported?: boolean,
 * }} adapters
 */
export const runSymlinkDestinationScenario = async ({
  control,
  waitForDownloads,
  downloadDir,
  filename,
  supported = true,
}) => {
  const linkParent = path.join(downloadDir, "e2e");
  const link = path.join(linkParent, "release-symlink");
  const target = path.join(path.dirname(downloadDir), `release-symlink-target-${filename}`);
  fs.mkdirSync(linkParent, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");

  try {
    await control.background.startDownload({
      content: "symlink destination smoke",
      suggestedFilename: filename,
      pageUrl: "https://symlink-smoke.example/",
      path: "e2e/release-symlink",
    });
    if (!supported) {
      const matches = await control.history.wait({
        finalFullPath: `e2e/release-symlink/${filename}`,
        status: "USER_CANCELED",
      });
      const rejected = requireValue(matches.at(-1), "Symlink rejection history was not observed");
      expect(rejected).toMatchObject({
        finalFullPath: `e2e/release-symlink/${filename}`,
        status: "USER_CANCELED",
      });
      expect(fs.existsSync(path.join(target, filename))).toBe(false);
      return;
    }
    const downloads = await waitForDownloads(filename);
    expect(downloads).toHaveLength(1);
    const completed = requireValue(downloads[0], "Symlink download was not captured");
    expect(completed.state).toBe("complete");
    expect(fs.realpathSync(path.dirname(completed.filename))).toBe(fs.realpathSync(target));
    expect(fs.readFileSync(path.join(target, filename), "utf8")).toBe("symlink destination smoke");
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
};

/**
 * Exercises menu-state construction and the production context-menu handler
 * through download completion. Native browser-chrome menu selection remains a
 * manual release check because CDP and Firefox RDP cannot operate that UI.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 * }} adapters
 */
export const runContextMenuScenario = async ({ control, waitForDownloads }) => {
  await control.options.set({ paths: "e2e/context-menu", selection: true });
  await control.background.clickContextMenu({
    info: {
      menuItemId: "save-in-0",
      selectionText: "context menu content",
      pageUrl: "https://example.com/",
    },
    tab: { id: 1, title: "context-menu-smoke", url: "https://example.com/" },
  });

  const downloads = await waitForDownloads("context-menu-smoke");
  expect(downloads).toHaveLength(1);
  const completed = requireValue(downloads[0], "Context-menu download was not captured");
  expect(completed.state).toBe("complete");
  expect(completed.filename).toMatch(
    /e2e[\\/]context-menu[\\/]context-menu-smoke\.selection\.txt$/,
  );
  expect(fs.readFileSync(completed.filename, "utf8")).toBe("context menu content");

  expect((await control.storage.local.get("lastUsedPath")).lastUsedPath).toBe("e2e/context-menu");
  await control.runtime.reset();
  await control.background.clickContextMenu({
    info: {
      menuItemId: "save-in-last-used",
      selectionText: "last used content",
      pageUrl: "https://example.com/",
    },
    tab: { id: 1, title: "last-used-smoke", url: "https://example.com/" },
  });

  const repeatedDownloads = await waitForDownloads("last-used-smoke");
  expect(repeatedDownloads).toHaveLength(1);
  const repeated = requireValue(repeatedDownloads[0], "Last-used download was not captured");
  expect(repeated.state).toBe("complete");
  expect(repeated.filename).toMatch(/e2e[\\/]context-menu[\\/]last-used-smoke\.selection\.txt$/);
  expect(fs.readFileSync(repeated.filename, "utf8")).toBe("last used content");
};

/**
 * Verifies the content-to-background bridge for page-owned link attributes.
 * The contextmenu event captures one exact anchor in the page; the subsequent
 * production menu command requests that frame's bounded metadata and routes on
 * both explicit fields.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   evaluatePage: (target: string, expression: string) => Promise<unknown>,
 * }} adapters
 */
export const runLinkMetadataRoutingScenario = async ({ control, evaluatePage }) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/link-metadata") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<a id="save-target" href="/asset.txt" title="full-size" download="original-name.txt">Download</a>',
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("link metadata fixture");
  });
  const port = await listenLocal(server);
  const target = `127.0.0.1:${port}/link-metadata`;
  const pageUrl = `http://${target}`;
  const linkUrl = `http://127.0.0.1:${port}/asset.txt`;
  const optionKeys = ["paths", "filenamePatterns"];
  const previous = await control.storage.local.get(optionKeys);
  const missing = optionKeys.filter((key) => !Object.hasOwn(previous, key));
  let tabId;

  try {
    await control.options.set({
      paths: "e2e/link-metadata",
      filenamePatterns: `linktitle: ^full-size$
linkdownload: ^original-name\\.txt$
into: routed/:linktitle:/:linkdownload:/`,
    });
    const created = await control.tabs.create({ url: pageUrl, active: true });
    tabId = created.id;
    await control.tabs.wait(tabId === undefined ? { urlIncludes: target } : { id: tabId });
    await evaluatePage(
      target,
      `new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const capture = () => {
          const link = document.querySelector("#save-target");
          if (link) {
            link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
            resolve(true);
          } else if (Date.now() >= deadline) reject(new Error("Link metadata fixture missing"));
          else requestAnimationFrame(capture);
        };
        capture();
      })`,
    );
    const tab = (await control.tabs.query()).find((candidate) => candidate.url?.includes(target));
    if (tab?.id === undefined) throw new Error("Link metadata fixture tab missing");
    await control.background.clickContextMenu({
      info: {
        menuItemId: "save-in-0",
        frameId: 0,
        linkUrl,
        pageUrl,
      },
      tab: { id: tab.id, title: "Link metadata", url: pageUrl },
    });

    const rows = await control.downloads.wait({
      filenameIncludes: `link-metadata${path.sep}routed`,
      minimumComplete: 1,
      timeoutMs: 10000,
    });
    const completed = requireValue(
      rows.find((row) => row.state === "complete"),
      "Link metadata save did not complete",
    );
    expect(completed.filename).toMatch(
      new RegExp(
        `e2e[\\\\/]link-metadata[\\\\/]routed[\\\\/]full-size[\\\\/]original-name\\.txt[\\\\/]asset\\.txt$`,
      ),
    );
    const history = await control.history.wait({ url: linkUrl, status: "complete" });
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variables: expect.objectContaining({
            linktitle: "full-size",
            linkdownload: "original-name.txt",
          }),
        }),
      ]),
    );
  } finally {
    try {
      await control.storage.local.set(previous);
      if (missing.length) await control.storage.local.remove(missing);
      if (tabId !== undefined) await control.tabs.remove(tabId).catch(() => {});
      await control.runtime.reset();
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * Drives the production Quick save path: the root-level Quick save item routes a
 * save straight to the resolved default destination, and the dynamic-default
 * toggle redirects that default from the Downloads root to a configured folder.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 * }} adapters
 */
export const runQuickSaveScenario = async ({ control, waitForDownloads }) => {
  await control.options.set({
    quickSaveEnabled: true,
    quickSaveDirectory: "e2e/quick-save",
    quickSaveUseDirectory: true,
    selection: true,
  });
  await control.background.clickContextMenu({
    info: {
      menuItemId: "save-in-quick-save",
      selectionText: "quick save content",
      pageUrl: "https://example.com/",
    },
    tab: { id: 1, title: "quick-save-smoke", url: "https://example.com/" },
  });

  const downloads = await waitForDownloads("quick-save-smoke");
  expect(downloads).toHaveLength(1);
  const completed = requireValue(downloads[0], "Quick save download was not captured");
  expect(completed.state).toBe("complete");
  expect(completed.filename).toMatch(/e2e[\\/]quick-save[\\/]quick-save-smoke\.selection\.txt$/);
  expect(fs.readFileSync(completed.filename, "utf8")).toBe("quick save content");

  // #144 offers this same item alone at top level, with no root around it.
  // Whether the browser then skips the submenu is NOT checkable here — no
  // WebExtension API enumerates menu items, and native menus are not in the DOM.
  // What is checkable is the half that broke real installs: rebuilding into a
  // shape where MENU_IDS.ROOT never exists, against the live contextMenus API.
  // Any item still claiming it as a parent fails there and not in jsdom, and an
  // option change routes through backgroundRuntime.reset(), so a throwing
  // rebuild surfaces as "init failed".
  await control.options.set({ quickSaveOnly: true });
  await control.background.clickContextMenu({
    info: {
      menuItemId: "save-in-quick-save",
      selectionText: "top level quick save",
      pageUrl: "https://example.com/",
    },
    tab: { id: 1, title: "quick-save-only", url: "https://example.com/" },
  });

  const topLevel = await waitForDownloads("quick-save-only");
  expect(topLevel).toHaveLength(1);
  const topLevelSave = requireValue(topLevel[0], "Top-level Quick save download was not captured");
  expect(topLevelSave.state).toBe("complete");
  expect(topLevelSave.filename).toMatch(/e2e[\\/]quick-save[\\/]quick-save-only\.selection\.txt$/);
  expect((await control.logs.get()).some((entry) => entry.message === "init failed")).toBe(false);

  // Leaving the mode has to put the root back: this rebuild recreates the very
  // parent the previous one skipped, and every other item depends on it.
  await control.options.set({ quickSaveOnly: false });
  await control.background.clickContextMenu({
    info: {
      menuItemId: "save-in-quick-save",
      selectionText: "root restored",
      pageUrl: "https://example.com/",
    },
    tab: { id: 1, title: "quick-save-restored", url: "https://example.com/" },
  });

  const restored = await waitForDownloads("quick-save-restored");
  expect(restored).toHaveLength(1);
  expect(requireValue(restored[0], "Restored Quick save download was not captured").state).toBe(
    "complete",
  );
  expect((await control.logs.get()).some((entry) => entry.message === "init failed")).toBe(false);
};

/**
 * Dispatches the production tab-strip handler with a real browser tab and
 * verifies the selected-tab shortcut reaches the download pipeline.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   filename: string,
 * }} adapters
 */
export const runTabStripScenario = async ({ control, waitForDownloads, filename }) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>${filename}</title>`);
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const previous = {
    shortcutTab: await control.options.get("shortcutTab"),
    shortcutType: await control.options.get("shortcutType"),
  };
  let tabId;

  try {
    const created = await control.tabs.create({ url });
    if (created.id === undefined) throw new Error("Tab-strip fixture tab has no ID");
    const tab = await control.tabs.wait({ id: created.id });
    tabId = tab.id;
    if (tab.id === undefined || tab.index === undefined || tab.windowId === undefined) {
      throw new Error("Tab-strip fixture tab is incomplete");
    }
    await control.options.set({ shortcutTab: true, shortcutType: "HTML_REDIRECT" });
    await control.background.clickTabMenu({
      info: { menuItemId: "save-in-SI-selected-tab" },
      tab: { ...tab, id: tab.id, index: tab.index, windowId: tab.windowId },
    });
    const downloads = await waitForDownloads(filename);
    const complete = requireValue(
      downloads.find((row) => row.state === "complete"),
      "Tab-strip download did not complete",
    );
    expect(fs.readFileSync(complete.filename, "utf8")).toContain(url);
  } finally {
    try {
      await control.options.set(previous);
      if (tabId != null) await control.tabs.remove(tabId).catch(() => {});
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * Verifies CSS routing in both content-owned paths: automatic discovery and a
 * manual Page Sources save. The duplicate URL proves both paths retain all
 * origins and preserve routing-rule order rather than DOM traversal order.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   evaluatePage: (target: string, expression: string) => Promise<unknown>,
 *   browserLabel: "chrome" | "firefox",
 * }} adapters
 */
export const runCssRoutingScenario = async ({ control, evaluatePage, browserLabel }) => {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/css-routing")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html>
        <article><img src="/css-shared.png" alt="article"></article>
        <aside><img class="avatar" src="/css-shared.png" alt="avatar"></aside>
        <video class="video-origin" src="/css-shared.png"></video>`);
      return;
    }
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end("css routing fixture");
  });
  const port = await listenLocal(server);
  const target = `127.0.0.1:${port}/css-routing`;
  const pageUrl = `http://${target}`;
  const keys = [
    "autoDownloadEnabled",
    "autoDownloadLive",
    "autoDownloadMaxPerPage",
    "filenamePatterns",
    "sourcePanelEnabled",
    "sourcePanelPreviews",
    "sourcePanelBackgrounds",
    "sourcePanelResourceHints",
    "sourcePanelLinks",
  ];
  const previous = await control.storage.local.get(keys);
  const missing = keys.filter((key) => !Object.hasOwn(previous, key));
  let tabId;

  try {
    await Promise.all([
      control.options.set({
        autoDownloadEnabled: true,
        autoDownloadLive: false,
        autoDownloadMaxPerPage: 4,
        filenamePatterns: `context: ^auto$
pageurl: /css-routing$
sourcekind: ^video$
css: video.video-origin
into: e2e/css-auto-${browserLabel}/:filename:

context: ^auto$
pageurl: /css-routing$
sourcekind: ^image$
css: article img
into: e2e/css-auto-traversal-order-${browserLabel}/:filename:`,
      }),
      control.storage.local.set({
        sourcePanelEnabled: true,
        sourcePanelPreviews: false,
        sourcePanelBackgrounds: false,
        sourcePanelResourceHints: false,
        sourcePanelLinks: false,
      }),
    ]);
    const created = await control.tabs.create({ url: pageUrl, active: true });
    tabId = created.id;
    await control.tabs.wait(tabId === undefined ? { urlIncludes: target } : { id: tabId });
    await evaluatePage(target, "document.readyState === 'complete'");
    const automatic = await control.downloads.wait({
      filenameIncludes: `css-auto-${browserLabel}`,
      minimumComplete: 1,
      timeoutMs: 10000,
    });
    expect(automatic.filter((row) => row.state === "complete")).toHaveLength(1);

    await control.options.set({
      autoDownloadEnabled: false,
      filenamePatterns: `pageurl: /css-routing(?:\\?manual)?$
css: aside img.avatar
into: e2e/css-manual-${browserLabel}/:filename:`,
    });
    if (tabId !== undefined) await control.tabs.remove(tabId);
    const manualTarget = `${target}?manual`;
    const manualTab = await control.tabs.create({ url: `${pageUrl}?manual`, active: true });
    tabId = manualTab.id;
    const tab = await control.tabs.wait({
      ...(tabId === undefined ? {} : { id: tabId }),
      urlIncludes: manualTarget,
    });
    if (tab?.id === undefined) throw new Error("CSS routing fixture tab missing");
    await control.storage.session.set({ sourcePanelOpen: true });
    await control.tabs.sendMessage(tab.id, { type: "SET_SOURCE_PANEL", body: { open: true } });
    await evaluatePage(
      manualTarget,
      `new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          const root = document.querySelector("#save-in-source-panel")?.shadowRoot;
          const row = root?.querySelector(".row");
          if (row) {
            row.querySelector(".actions .primary-action")?.click();
            resolve(true);
          } else if (Date.now() >= deadline) reject(new Error("Page Sources row did not appear"));
          else requestAnimationFrame(check);
        };
        check();
      })`,
    );
    const manual = await control.downloads.wait({
      filenameIncludes: `css-manual-${browserLabel}`,
      minimumComplete: 1,
      timeoutMs: 10000,
    });
    expect(manual.filter((row) => row.state === "complete")).toHaveLength(1);
  } finally {
    try {
      await control.storage.session.set({ sourcePanelOpen: false });
      await control.storage.local.set(previous);
      if (missing.length) await control.storage.local.remove(missing);
      if (tabId !== undefined) await control.tabs.remove(tabId).catch(() => {});
      await control.runtime.reset();
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 * }} adapters
 */
export const runShortcutScenario = async ({ control, waitForDownloads }) => {
  await control.background.startDownload({
    shortcutUrl: "https://example.com/target",
    suggestedFilename: "page-shortcut.html",
    pageUrl: "https://example.com/",
  });
  const downloads = await waitForDownloads("page-shortcut");
  expect(downloads).toHaveLength(1);
  const completed = requireValue(downloads[0], "Shortcut download was not captured");
  expect(completed.state).toBe("complete");
  expect(completed.filename.endsWith("page-shortcut.html")).toBe(true);
  expect(fs.readFileSync(completed.filename, "utf8")).toContain(
    'window.location.href = "https://example.com/target"',
  );
};

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForLog: (baseline: number, messages: string[]) => Promise<LogEntry[]>,
 *   filename?: string,
 * }} adapters
 */
export const runFailedDownloadLogScenario = async ({
  control,
  waitForLog,
  filename = "unreachable.bin",
}) => {
  const baseline = (await control.logs.get()).length;
  await control.background.startDownload({
    url: `http://127.0.0.1:1/${filename}`,
    suggestedFilename: filename,
    pageUrl: "https://example.com/",
  });
  const entries = await waitForLog(baseline, ["download failed", "downloads.download failed"]);
  expect(entries.length).toBeGreaterThanOrEqual(1);
};

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string, deadlineMs?: number) => Promise<DownloadSummary[]>,
 *   filename: string,
 * }} adapters
 */
export const runAutomaticRetryScenario = async ({ control, waitForDownloads, filename }) => {
  const body = `recovered ${filename}`;
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (hits === 1) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(body);
  });
  const port = await listenLocal(server);
  const optionKeys = ["fallbackFetch", "filenamePatterns"];
  const previous = await control.storage.local.get(optionKeys);

  try {
    await control.options.set({ fallbackFetch: true, filenamePatterns: "" });
    await control.background.startDownload({
      url: `http://127.0.0.1:${port}/${filename}`,
      suggestedFilename: filename,
      pageUrl: `http://127.0.0.1:${port}/`,
    });

    const rows = await waitForDownloads(filename, 10000);
    const completed = requireValue(
      rows.find((row) => row.state === "complete"),
      "Automatic retry download did not complete",
    );
    expect(fs.readFileSync(completed.filename, "utf8")).toBe(body);
    expect(hits).toBeGreaterThanOrEqual(2);
  } finally {
    try {
      await control.storage.local.remove(optionKeys);
      await control.storage.local.set(previous);
      await control.runtime.reset();
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * Completes a real save, undoes it through the History protocol, and proves
 * the file is removed while the History entry is marked undone rather than
 * deleted. A second save covers the degraded path: a file removed out of band
 * with its shelf entry already erased still resolves as undone, with the
 * missing file reported.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string, timeoutMs?: number) => Promise<DownloadSummary[]>,
 *   filename: string,
 *   detectsMissingFile?: boolean,
 * }} adapters
 */
export const runUndoLastSaveScenario = async ({
  control,
  waitForDownloads,
  filename,
  detectsMissingFile = true,
}) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end("undo scenario content");
  });
  const port = await listenLocal(server);
  const optionKeys = ["filenamePatterns"];
  const previous = await control.storage.local.get(optionKeys);
  const missingKeys = optionKeys.filter((key) => !Object.hasOwn(previous, key));

  /** @param {string} name */
  const saveAndFindEntry = async (name) => {
    const url = `http://127.0.0.1:${port}/${name}`;
    await control.background.startDownload({
      url,
      suggestedFilename: name,
      pageUrl: "https://undo.example/",
      path: "e2e/undo",
    });
    const downloads = await waitForDownloads(name);
    const completed = requireValue(
      downloads.find((row) => row.state === "complete"),
      "Undo scenario download did not complete",
    );
    const entries = await control.history.wait({ url, status: "complete" });
    const entry = requireValue(
      entries.find((row) => row.url === url && typeof row.downloadId === "number"),
      "Undo scenario History entry was not recorded with a download id",
    );
    return {
      completed,
      historyId: decodeString(entry.id),
      downloadId: decodeNumber(entry.downloadId),
    };
  };

  try {
    await control.options.set({ filenamePatterns: "" });

    const first = await saveAndFindEntry(`${filename}.bin`);
    expect(fs.existsSync(first.completed.filename)).toBe(true);
    const undone = await control.runtime.send({
      type: "HISTORY_UNDO",
      body: { historyId: first.historyId },
    });
    expect(undone).toEqual({ type: "HISTORY_UNDO", body: { undone: true, fileMissing: false } });
    expect(fs.existsSync(first.completed.filename)).toBe(false);
    await control.history.wait({ id: first.historyId, status: "undone" });

    const second = await saveAndFindEntry(`${filename}-missing.bin`);
    fs.rmSync(second.completed.filename);
    const missing = await control.runtime.send({
      type: "HISTORY_UNDO",
      body: { historyId: second.historyId },
    });
    // Firefox's removeFile rejects for an out-of-band-removed file, so the
    // response carries the distinct file-missing flag. Chromium's deletion is
    // idempotent and it re-checks file existence lazily, so until it happens
    // to observe the removal the undo is indistinguishable from a normal one
    // — the end state (file gone, entry undone) is identical either way.
    expect(missing).toEqual({
      type: "HISTORY_UNDO",
      body: { undone: true, fileMissing: detectsMissingFile },
    });
    await control.history.wait({ id: second.historyId, status: "undone" });

    // Once the shelf entry is erased the extension can no longer verify the
    // download's identity or reach its file, so undo must refuse honestly
    // rather than claim success — the entry stays complete.
    const third = await saveAndFindEntry(`${filename}-erased.bin`);
    await control.downloads.erase({ id: third.downloadId });
    const refused = await control.runtime.send({
      type: "HISTORY_UNDO",
      body: { historyId: third.historyId },
    });
    expect(refused).toEqual({ type: "HISTORY_UNDO", body: { undone: false, fileMissing: false } });
    expect(fs.existsSync(third.completed.filename)).toBe(true);
    const entries = await control.history.wait({ id: third.historyId, status: "complete" });
    expect(entries.some((row) => row.id === third.historyId && row.status === "complete")).toBe(
      true,
    );
  } finally {
    try {
      await control.storage.local.set(previous);
      if (missingKeys.length > 0) await control.storage.local.remove(missingKeys);
      await control.runtime.reset();
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * Moves a completed save to a different configured folder through the History
 * protocol: the source is downloaded again into the destination, the verified
 * original file is removed, and the two entries are linked, with the original
 * marked moved rather than deleted.
 *
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   waitForDownloads: (filename: string, timeoutMs?: number) => Promise<DownloadSummary[]>,
 *   filename: string,
 * }} adapters
 */
export const runRerouteLastSaveScenario = async ({ control, waitForDownloads, filename }) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end("reroute scenario content");
  });
  const port = await listenLocal(server);
  const name = `${filename}.bin`;
  const url = `http://127.0.0.1:${port}/${name}`;
  const optionKeys = ["filenamePatterns"];
  const previous = await control.storage.local.get(optionKeys);
  const missingKeys = optionKeys.filter((key) => !Object.hasOwn(previous, key));

  try {
    await control.options.set({ filenamePatterns: "" });
    await control.background.startDownload({
      url,
      suggestedFilename: name,
      pageUrl: "https://reroute.example/",
      path: "e2e/reroute-from",
    });
    const downloads = await waitForDownloads(name);
    const original = requireValue(
      downloads.find((row) => row.state === "complete"),
      "Reroute scenario download did not complete",
    );
    const entries = await control.history.wait({ url, status: "complete" });
    const entry = requireValue(
      entries.find((row) => row.url === url && typeof row.downloadId === "number"),
      "Reroute scenario History entry was not recorded with a download id",
    );
    const historyId = decodeString(entry.id);

    const response = await control.runtime.send({
      type: "HISTORY_REROUTE",
      body: { historyId, destination: "e2e/reroute-to" },
    });
    if (response.type !== "HISTORY_REROUTE" || !("rerouted" in response.body)) {
      throw new Error(`Unexpected reroute response: ${JSON.stringify(response)}`);
    }
    expect(response.body.rerouted).toBe(true);
    // Long replacements return while the persisted move is pending; the
    // top-level completion listener removes the original only after the new
    // file is complete. A very fast replacement may already be finalized.
    expect(response.body.oldRemoved).toBe(response.body.pending !== true);
    const newHistoryId = decodeString(response.body.newHistoryId);

    // The replacement completes under the new folder while the original file
    // is gone and its row is marked moved and linked, never deleted.
    const rerouted = await control.downloads.wait({
      filenameIncludes: "e2e/reroute-to",
      timeoutMs: 8000,
    });
    const replacement = requireValue(
      rerouted.find(
        (row) => row.state === "complete" && /reroute-to/.test(row.filename.replaceAll("\\", "/")),
      ),
      "Rerouted download did not complete in the destination folder",
    );
    expect(fs.readFileSync(replacement.filename, "utf8")).toBe("reroute scenario content");
    const moved = await control.history.wait({ id: historyId, status: "moved" });
    expect(fs.existsSync(original.filename)).toBe(false);
    expect(moved.some((row) => row.id === historyId && row.rerouteTo === newHistoryId)).toBe(true);
    const linked = await control.history.wait({ id: newHistoryId, status: "complete" });
    expect(linked.some((row) => row.id === newHistoryId && row.rerouteOf === historyId)).toBe(true);
  } finally {
    try {
      await control.storage.local.set(previous);
      if (missingKeys.length > 0) await control.storage.local.remove(missingKeys);
      await control.runtime.reset();
    } finally {
      await closeLocal(server);
    }
  }
};
