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
  decodeBoolean,
  decodeNumber,
  decodeRecord,
  decodeString,
  decodeUnknown,
  evaluateJson,
  listenLocal,
  objectOf,
  optional,
  requireValue,
  waitForApiEntriesExpression,
} from "./helpers.mjs";
import { decodeHistoryEntries, decodeLogEntries } from "./control-codecs.mjs";

/** @typedef {import("./control-protocol.mjs").DownloadSummary} DownloadSummary */
/** @typedef {import("./control-protocol.mjs").HistoryEntry} HistoryEntry */
/** @typedef {import("./control-protocol.mjs").LogEntry} LogEntry */

/**
 * @param {{
 *   evaluate: (expression: string) => Promise<unknown>,
 *   downloadUsingBrowserFilename: (url: string) => Promise<string>,
 *   waitForDownloadUrl: (url: string) => Promise<string>,
 * }} adapters
 */
export const runContentDispositionScenario = async ({
  evaluate,
  downloadUsingBrowserFilename,
  waitForDownloadUrl,
}) => {
  const { server, port } = await startContentDispositionServer();
  try {
    for (const fixture of CONTENT_DISPOSITION_CASES) {
      const nativeUrl = `http://127.0.0.1:${port}/${fixture.id}?source=native`;
      const saveInUrl = `http://127.0.0.1:${port}/${fixture.id}?source=save-in`;
      const nativeFilename = await downloadUsingBrowserFilename(nativeUrl);
      await evaluate(
        `api.startDownload({
          url: ${JSON.stringify(saveInUrl)},
          suggestedFilename: ${JSON.stringify(`${fixture.id}-url-fallback.bin`)},
          pageUrl: ${JSON.stringify(`http://127.0.0.1:${port}/`)},
          path: "e2e/content-disposition",
        }).then(() => true)`,
      );
      expect.soft(await waitForDownloadUrl(saveInUrl), fixture.id).toBe(nativeFilename);
    }
  } finally {
    await closeLocal(server);
  }
};

/**
 * Drives a private context-menu save through the production pipeline and
 * verifies that private activity never reaches extension persistence.
 *
 * @param {{
 *   evaluate: (expression: string) => Promise<unknown>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   filename: string,
 * }} adapters
 */
export const runPrivateContextScenario = async ({ evaluate, waitForDownloads, filename }) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("private context content");
  });
  const port = await listenLocal(server);
  const privateUrl = `http://127.0.0.1:${port}/${filename}.txt`;
  const snapshot = await evaluateJson(
    evaluate,
    `Promise.all([
      browser.storage.local.get(["paths", "save-in-history", "save-in-last-used-path", "save-in-last-used-meta"]),
      browser.storage.session.get(null),
      api.logs(),
    ]).then(([local, session, log]) => JSON.stringify({ local, session, log }))`,
    objectOf({ local: decodeRecord, session: decodeRecord, log: arrayOf(decodeRecord) }),
  );

  try {
    await evaluate(`browser.storage.local.set({ paths: "e2e/private" })
      .then(() => api.reset())
      .then(() => api.clickContextMenu({
        info: {
          menuItemId: "save-in-0",
          mediaType: "image",
          srcUrl: ${JSON.stringify(privateUrl)},
          pageUrl: "https://private.example/",
        },
        tab: {
          id: 91,
          title: ${JSON.stringify(filename)},
          url: "https://private.example/",
          incognito: true,
        },
      })).then(() => "clicked")`);

    const downloads = await waitForDownloads(filename);
    expect(downloads).toHaveLength(1);
    const completed = requireValue(downloads[0], "Private-context download was not captured");
    expect(completed.state).toBe("complete");
    expect(fs.readFileSync(completed.filename, "utf8")).toBe("private context content");

    const after = await evaluateJson(
      evaluate,
      `Promise.all([
        browser.storage.local.get(["save-in-history", "save-in-last-used-path", "save-in-last-used-meta"]),
        browser.storage.session.get(null),
        api.logs(),
      ]).then(([local, session, log]) => JSON.stringify({ local, session, log }))`,
      objectOf({ local: decodeRecord, session: decodeRecord, log: arrayOf(decodeRecord) }),
    );
    expect(after.local["save-in-history"]).toEqual(snapshot.local["save-in-history"]);
    expect(after.local["save-in-last-used-path"]).toEqual(snapshot.local["save-in-last-used-path"]);
    expect(after.local["save-in-last-used-meta"]).toEqual(snapshot.local["save-in-last-used-meta"]);
    expect(after.log).toEqual(snapshot.log);
    expect(Object.keys(after.session.siActiveTransfers || {})).toHaveLength(0);
  } finally {
    const hadPaths = Object.hasOwn(snapshot.local, "paths");
    try {
      await evaluate(`${hadPaths ? `browser.storage.local.set({ paths: ${JSON.stringify(snapshot.local.paths)} })` : 'browser.storage.local.remove("paths")'}
        .then(() => api.reset()).then(() => "restored")`);
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
 *   evaluate: (expression: string) => Promise<unknown>,
 *   openPrivatePage: (url: string) => Promise<{tabId: number, target: string, close: () => Promise<void>}>,
 *   evaluatePrivatePage: (target: string, expression: string) => Promise<unknown>,
 *   waitForFile: (relativePath: string) => Promise<string>,
 *   filenamePrefix: string,
 * }} adapters
 */
export const runPrivateBrowserActivityScenario = async ({
  evaluate,
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
  const before = await evaluateJson(
    evaluate,
    `Promise.all([
      browser.storage.local.get(${JSON.stringify(optionKeys)}), api.history(), api.logs()
    ]).then(([options, history, log]) => JSON.stringify({ options, history, log }))`,
    objectOf({
      options: decodeRecord,
      history: decodeHistoryEntries,
      log: decodeLogEntries,
    }),
  );
  const missingKeys = optionKeys.filter((key) => !(key in before.options));
  /** @type {{tabId: number, target: string, close: () => Promise<void>} | undefined} */
  let privatePage;

  try {
    await evaluate(`browser.storage.local.set({
      trackBrowserDownloads: true,
      routeBrowserDownloads: true,
      routeBrowserDownloadsFirefox: true,
      browserDownloadFilter: "*://127.0.0.1/*",
      autoDownloadEnabled: true,
      autoDownloadLive: true,
      autoDownloadPrivate: false,
      autoDownloadMaxPerPage: 2,
      sourcePanelEnabled: true,
      filenamePatterns: ${JSON.stringify(
        `context: ^browser$
sourceurl: ${filenamePrefix}-native\\.bin$
into: e2e/private-ordinary-should-not-route/:filename:

context: ^auto$
pageurl: ^http://127\\.0\\.0\\.1:${port}/private-browser$
sourcekind: ^image$
sourceurl: ${filenamePrefix}-(?:initial|late)\\.png$
into: e2e/private-auto/:filename:`,
      )},
    }).then(() => api.reset())`);
    privatePage = await openPrivatePage(pageUrl);
    await evaluate(`browser.tabs.sendMessage(${privatePage.tabId}, {
      type: "SET_SOURCE_PANEL", body: { open: true }
    }).then(() => true)`);
    await evaluatePrivatePage(
      privatePage.target,
      `new Promise((resolve, reject) => {
        const timeout = AbortSignal.timeout(8000);
        const check = () => {
          if (document.querySelector("#save-in-source-panel")?.shadowRoot) resolve(true);
          else if (timeout.aborted) reject(new Error("Private content script did not become ready"));
          else requestAnimationFrame(check);
        };
        check();
      })`,
    );
    const beforeOptIn = await evaluateJson(
      evaluate,
      `browser.downloads.search({}).then((items) => JSON.stringify(items.filter(
        (item) => item.url === "http://127.0.0.1:${port}/${initialName}"
      )))`,
      arrayOf(decodeRecord),
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
    await evaluate(`api.setOptions({ autoDownloadPrivate: true })`);
    await evaluate(`browser.tabs.reload(${privatePage.tabId}).then(() => new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(8000);
      const check = async () => {
        const tab = await browser.tabs.get(${privatePage.tabId});
        if (tab.status === "complete") resolve(true);
        else if (timeout.aborted) reject(new Error("Private fixture did not reload"));
        else {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            void check();
          };
          channel.port2.postMessage(null);
        }
      };
      void check();
    }))`);
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

    const after = await evaluateJson(
      evaluate,
      `Promise.all([api.history(), api.logs()])
          .then(([history, log]) => JSON.stringify({ history, log }))`,
      objectOf({ history: decodeHistoryEntries, log: decodeLogEntries }),
    );
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
      await evaluate(`Promise.all([
        browser.storage.local.set(${JSON.stringify(before.options)}),
        browser.storage.local.remove(${JSON.stringify(missingKeys)}),
      ]).then(() => api.reset())`);
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
 *   evaluate: (expression: string) => Promise<unknown>,
 *   sendExternal: (message: Record<string, unknown>) => Promise<unknown>,
 *   callerId: string,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   filename: string,
 * }} adapters
 */
export const runExternalExtensionScenario = async ({
  evaluate,
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
  const previous = await evaluateJson(
    evaluate,
    `browser.storage.local.get(${JSON.stringify(optionKeys)})
      .then((stored) => JSON.stringify(stored))`,
    decodeRecord,
  );
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
    const rejection = await evaluateJson(
      evaluate,
      `browser.runtime.sendMessage({ type: "EXTERNAL_DOWNLOAD_REJECTIONS_GET" })
        .then((response) => JSON.stringify(response.body.rejections.find(
          (entry) => entry.senderId === ${JSON.stringify(callerId)}
        )))`,
      objectOf({ senderId: decodeString, attempts: decodeNumber }),
    );
    expect(rejection).toMatchObject({ senderId: callerId, attempts: 1 });

    await evaluate(`browser.storage.local.set({
      externalDownloadAllowlist: ${JSON.stringify(callerId)},
      filenamePatterns: "comment: ^external-e2e$\\ninto: e2e/external/:filename:",
    }).then(() => api.reset())`);
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
      await evaluate(`Promise.all([
        browser.storage.local.set(${JSON.stringify(previous)}),
        browser.storage.local.remove(${JSON.stringify(missingKeys)}),
        browser.runtime.sendMessage({
          type: "EXTERNAL_DOWNLOAD_REJECTION_CLEAR",
          body: { senderId: ${JSON.stringify(callerId)} },
        }),
      ]).then(() => api.reset())`);
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * Cancels a real stalled acquisition through the History protocol and proves
 * that both the network request and durable transfer state are released.
 *
 * @param {{evaluate: (expression: string) => Promise<unknown>, filename: string}} adapters
 */
export const runHistoryCancellationScenario = async ({ evaluate, filename }) => {
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
  const server = http.createServer((_req, res) => {
    pendingResponse = res;
    res.once("close", () => requestClosedResolve?.());
    requestStartedResolve?.();
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const previous = await evaluateJson(
    evaluate,
    `Promise.all([
      api.getOption("fetchViaFetch"), api.getOption("filenamePatterns")
    ]).then(([fetchViaFetch, filenamePatterns]) =>
      JSON.stringify({ fetchViaFetch, filenamePatterns }))`,
    objectOf({ fetchViaFetch: decodeBoolean, filenamePatterns: decodeUnknown }),
  );

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
    const response = await evaluateJson(
      evaluate,
      `browser.runtime.sendMessage({
        type: "HISTORY_CANCEL", body: { historyId: ${JSON.stringify(historyId)} }
      }).then(JSON.stringify)`,
      objectOf({
        type: decodeString,
        body: objectOf({ canceled: decodeBoolean }),
      }),
    );
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
    await evaluate(`api.setOptions(${JSON.stringify(previous)})`);
    await closeLocal(server);
  }
};

/**
 * Starts a real background fetch, restarts the background while it is in
 * flight, and verifies cold-start recovery clears the durable transfer record.
 *
 * @param {{
 *   evaluate: (expression: string) => Promise<unknown>,
 *   restartBackground: () => Promise<void>,
 *   filename: string,
 * }} adapters
 */
export const runInterruptedTransferRecoveryScenario = async ({
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
  const server = http.createServer((_req, res) => {
    pendingResponse = res;
    requestStartedResolve?.();
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const previousFetchViaFetch = decodeBoolean(await evaluate(`api.getOption("fetchViaFetch")`));

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
    await evaluate(`api.setOptions({ fetchViaFetch: ${JSON.stringify(previousFetchViaFetch)} })`);
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
    await control.storage.local.get(["paths", "filenamePatterns", "contentClickToSaveCombo"])
  );
  const legacyKeys = ["paths", "filenamePatterns", "contentClickToSaveCombo"];
  const missingLegacyKeys = legacyKeys.filter((key) => !(key in previous));

  try {
    await control.options.set({
      paths: "e2e/legacy-custom",
      filenamePatterns: "mime: ^image/png$\ninto: legacy-custom/:filename:",
      contentClickToSaveCombo: 18,
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
 *   evaluate: (expression: string) => Promise<unknown>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   downloadDir: string,
 *   filename: string,
 *   supported?: boolean,
 * }} adapters
 */
export const runSymlinkDestinationScenario = async ({
  evaluate,
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
    await evaluate(`api.startDownload({
      content: "symlink destination smoke",
      suggestedFilename: ${JSON.stringify(filename)},
      pageUrl: "https://symlink-smoke.example/",
      path: "e2e/release-symlink",
    }).then(() => "started")`);
    if (!supported) {
      const matches = await evaluateJson(
        evaluate,
        waitForApiEntriesExpression(
          "history",
          `(row) => row.finalFullPath === ${JSON.stringify(`e2e/release-symlink/${filename}`)} && row.status === "USER_CANCELED"`,
        ),
        decodeHistoryEntries,
      );
      const rejected = matches.at(-1);
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
};

/**
 * Dispatches the production tab-strip handler with a real browser tab and
 * verifies the selected-tab shortcut reaches the download pipeline.
 *
 * @param {{
 *   evaluate: (expression: string) => Promise<unknown>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   filename: string,
 * }} adapters
 */
export const runTabStripScenario = async ({ evaluate, waitForDownloads, filename }) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>${filename}</title>`);
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const previous = await evaluateJson(
    evaluate,
    `Promise.all([
      api.getOption("shortcutTab"), api.getOption("shortcutType")
    ]).then(([shortcutTab, shortcutType]) => JSON.stringify({ shortcutTab, shortcutType }))`,
    objectOf({ shortcutTab: decodeBoolean, shortcutType: decodeString }),
  );
  let tabId;

  try {
    const tab = await evaluateJson(
      evaluate,
      `browser.tabs.create({ url: ${JSON.stringify(url)} }).then((created) =>
        new Promise((resolve, reject) => {
          const timeout = AbortSignal.timeout(8000);
          const check = async () => {
            const current = await browser.tabs.get(created.id);
            if (current.status === "complete") resolve(JSON.stringify(current));
            else if (timeout.aborted) reject(new Error("Tab-strip fixture did not load"));
            else {
              const channel = new MessageChannel();
              channel.port1.onmessage = () => {
                channel.port1.close();
                channel.port2.close();
                void check();
              };
              channel.port2.postMessage(null);
            }
          };
          void check();
        }))`,
      objectOf({
        id: decodeNumber,
        index: decodeNumber,
        windowId: decodeNumber,
        title: optional(decodeString),
        url: optional(decodeString),
      }),
    );
    tabId = tab.id;
    await evaluate(`api.setOptions({ shortcutTab: true, shortcutType: "HTML_REDIRECT" })
      .then(() => api.clickTabMenu({
        info: { menuItemId: "save-in-SI-selected-tab" },
        tab: ${JSON.stringify(tab)},
      }))`);
    const downloads = await waitForDownloads(filename);
    const complete = requireValue(
      downloads.find((row) => row.state === "complete"),
      "Tab-strip download did not complete",
    );
    expect(fs.readFileSync(complete.filename, "utf8")).toContain(url);
  } finally {
    try {
      await evaluate(`api.setOptions(${JSON.stringify(previous)})
        .then(() => ${tabId == null ? "undefined" : `browser.tabs.remove(${tabId}).catch(() => {})`})`);
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
