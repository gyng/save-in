import { SHORTCUT_TYPES } from "../shared/constants.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { Download } from "../downloads/download.ts";
import type { DownloadInfo, DownloadLaunchResult } from "../downloads/download-types.ts";
import { Shortcut } from "../downloads/shortcut.ts";
import { Path } from "../routing/path.ts";
import { backgroundRuntime } from "./runtime.ts";

export const BACKGROUND_E2E_COMMAND = "SAVE_IN_E2E_START_DOWNLOAD";

type BackgroundE2EDownload = {
  path?: string;
  content?: string;
  url?: string;
  shortcutUrl?: string;
  suggestedFilename: string;
  pageUrl?: string;
  modifiers?: string[];
};

type BackgroundE2ECommandRequest = {
  type: typeof BACKGROUND_E2E_COMMAND;
  body: BackgroundE2EDownload;
};

type BackgroundE2ECommandResponse = {
  type: typeof BACKGROUND_E2E_COMMAND;
  body: { status: "OK"; result: DownloadLaunchResult } | { status: "ERROR"; message: string };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const isBackgroundE2ECommand = (value: unknown): value is BackgroundE2ECommandRequest => {
  if (!isRecord(value) || value.type !== BACKGROUND_E2E_COMMAND || !isRecord(value.body)) {
    return false;
  }
  return typeof value.body.suggestedFilename === "string";
};

const resolveDownloadUrl = (request: BackgroundE2EDownload): string => {
  if (request.shortcutUrl) {
    return Shortcut.makeShortcut(SHORTCUT_TYPES.HTML_REDIRECT, request.shortcutUrl);
  }
  if (request.content !== undefined) return Download.makeObjectUrl(request.content);
  if (request.url) return request.url;
  throw new Error("E2E download requires content, url, or shortcutUrl");
};

export const handleBackgroundE2ECommand = async (
  rawRequest: unknown,
): Promise<BackgroundE2ECommandResponse | null> => {
  if (!isBackgroundE2ECommand(rawRequest)) return null;
  try {
    await (backgroundRuntime.ready ?? Promise.resolve());
    const request = rawRequest.body;
    const info: DownloadInfo = {
      url: resolveDownloadUrl(request),
      suggestedFilename: request.suggestedFilename,
      pageUrl: request.pageUrl,
      modifiers: request.modifiers ?? [],
    };
    const result = await Download.launch({
      path: new Path(request.path ?? "e2e"),
      scratch: {},
      info,
    });
    return { type: BACKGROUND_E2E_COMMAND, body: { status: "OK", result } };
  } catch (error) {
    return {
      type: BACKGROUND_E2E_COMMAND,
      body: { status: "ERROR", message: error instanceof Error ? error.message : String(error) },
    };
  }
};

export const registerBackgroundE2ECommand = (): void => {
  webExtensionApi.runtime.onMessage.addListener((rawRequest, _sender, sendResponse) => {
    if (!isBackgroundE2ECommand(rawRequest)) return;
    void handleBackgroundE2ECommand(rawRequest).then(sendResponse);
    return true;
  });
};
