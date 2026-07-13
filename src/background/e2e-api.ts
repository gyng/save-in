import { SHORTCUT_TYPES } from "../shared/constants.ts";
import { CURRENT_BROWSER, WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { OptionsManagement } from "../config/option.ts";
import { options } from "../config/options-data.ts";
import type { SaveInOptions } from "../config/option-schema.ts";
import { Download } from "../downloads/download.ts";
import type { DownloadInfo } from "../downloads/download-types.ts";
import { Notifier } from "../downloads/notification.ts";
import { Shortcut } from "../downloads/shortcut.ts";
import { Path } from "../routing/path.ts";
import { peekCounter, resetCounter } from "./counter.ts";
import { SaveHistory } from "./history.ts";
import { Log } from "./log.ts";
import { menuState } from "./menu-build.ts";
import { Messaging } from "./messaging.ts";
import { backgroundRuntime } from "./runtime.ts";
import { BackgroundState } from "./state.ts";

type E2EDownload = {
  path?: string;
  content?: string;
  url?: string;
  shortcutUrl?: string;
  suggestedFilename: string;
  pageUrl?: string;
  modifiers?: string[];
  expectDownload?: boolean;
  runtimeOptions?: Partial<SaveInOptions>;
};

type E2EMessageDownload = {
  content?: string;
  url?: string;
  info?: Record<string, unknown>;
  comment?: string;
  sender?: browser.runtime.MessageSender;
};

const resolveDownloadUrl = (request: E2EDownload): string => {
  if (request.shortcutUrl) {
    return Shortcut.makeShortcut(SHORTCUT_TYPES.HTML_REDIRECT, request.shortcutUrl);
  }
  if (request.content !== undefined) return Download.makeObjectUrl(request.content);
  if (request.url) return request.url;
  throw new Error("E2E download requires content, url, or shortcutUrl");
};

export const createBackgroundE2EApi = () =>
  Object.freeze({
    ready: () => backgroundRuntime.ready ?? Promise.resolve(),
    reset: () => backgroundRuntime.reset(),
    inspect: async () => {
      await backgroundRuntime.ready;
      return {
        browser: CURRENT_BROWSER,
        capabilities: WEB_EXTENSION_CAPABILITIES,
        promptConflictAction: OptionsManagement.OPTION_KEYS[0].onLoad("prompt"),
        pathErrors: backgroundRuntime.optionErrors.paths.length,
        patternErrors: backgroundRuntime.optionErrors.filenamePatterns.length,
        menuCount: Object.keys(menuState.pathMappings).length,
        hasObjectUrl: typeof URL.createObjectURL === "function",
      };
    },
    logs: () => Log.get(),
    history: () => SaveHistory.get(),
    menuSnapshot: () => ({
      count: Object.keys(menuState.pathMappings).length,
      lastUsedPath: String(menuState.lastUsedPath),
    }),
    getOption: <Name extends keyof SaveInOptions>(name: Name): SaveInOptions[Name] => options[name],
    setOptions: (values: Partial<SaveInOptions>): void => {
      Object.assign(options, values);
    },
    startDownload: async (request: E2EDownload) => {
      await (backgroundRuntime.ready ?? Promise.resolve());
      if (request.runtimeOptions) Object.assign(options, request.runtimeOptions);
      if (request.expectDownload !== false) Notifier.expectDownload();
      const info: DownloadInfo = {
        url: resolveDownloadUrl(request),
        suggestedFilename: request.suggestedFilename,
        pageUrl: request.pageUrl,
        modifiers: request.modifiers ?? [],
      };
      return Download.renameAndDownload({
        path: new Path(request.path ?? "e2e"),
        scratch: {},
        info,
      });
    },
    resetCounter: () => resetCounter(BackgroundState.counterWrites, webExtensionApi.storage.local),
    peekCounter: () => peekCounter(webExtensionApi.storage.local),
    applyConfig: (config: Record<string, unknown>) =>
      new Promise<unknown>((resolve) => {
        void Messaging.handleApplyConfig(
          { type: "APPLY_CONFIG", body: { config } },
          {},
          (response) => resolve((response as { body?: unknown }).body),
        );
      }),
    downloadMessage: (request: E2EMessageDownload) =>
      new Promise<unknown>((resolve) => {
        const url =
          request.content !== undefined ? Download.makeObjectUrl(request.content) : request.url;
        Messaging.handleDownloadMessage(
          {
            type: "DOWNLOAD",
            body: { url: url ?? "", info: request.info, comment: request.comment },
          },
          request.sender ?? {},
          resolve,
        );
      }),
  });

export type BackgroundE2EApi = ReturnType<typeof createBackgroundE2EApi>;
