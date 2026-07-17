// Chrome's built-in Prompt API (on-device Gemini Nano). Two hard constraints
// shape this module:
//
//   1. Chrome-only. Firefox has no equivalent, so every entry point
//      feature-detects and callers degrade to the hand-authoring path.
//   2. Not available in Web Workers ("responsible document" requirement), so
//      the MV3 background service worker cannot call it. The reachable
//      contexts are the offscreen document and extension pages (options).
//      Shared background code must route a request to the offscreen document
//      rather than import a caller of runPrompt directly.
//
// Inference is on-device: no network after the one-time model download, and
// no prompt content leaves the machine — the property that makes local
// rule-authoring assistance privacy-safe where cloud inference was not.

export type PromptAvailability = "unavailable" | "downloadable" | "downloading" | "available";

type LanguageModelSession = {
  prompt: (
    input: string,
    options?: { signal?: AbortSignal; responseConstraint?: Record<string, unknown> },
  ) => Promise<string>;
  destroy: () => void;
};

type LanguageModelDownloadMonitor = {
  addEventListener: (
    type: "downloadprogress",
    listener: (event: { loaded: number }) => void,
  ) => void;
};

type LanguageModelCreateOptions = {
  signal?: AbortSignal;
  monitor?: (monitor: LanguageModelDownloadMonitor) => void;
};

type LanguageModelStatic = {
  availability: () => Promise<PromptAvailability>;
  create: (options?: LanguageModelCreateOptions) => Promise<LanguageModelSession>;
};

// The global is a platform declaration gap (not in the TS lib). Read it as
// unknown and narrow before use; the final assertion is a checked boundary.
const getLanguageModel = (): LanguageModelStatic | null => {
  const candidate: unknown = Reflect.get(globalThis, "LanguageModel");
  if (
    candidate !== null &&
    (typeof candidate === "object" || typeof candidate === "function") &&
    typeof (candidate as { availability?: unknown }).availability === "function" &&
    typeof (candidate as { create?: unknown }).create === "function"
  ) {
    return candidate as LanguageModelStatic;
  }
  return null;
};

export const hasPromptApi = (): boolean => getLanguageModel() !== null;

export const promptAvailability = async (): Promise<PromptAvailability> => {
  const model = getLanguageModel();
  if (!model) return "unavailable";
  try {
    return await model.availability();
  } catch {
    // A present-but-throwing API is treated as unavailable, never a hard error.
    return "unavailable";
  }
};

// Runs one prompt against the on-device model, or returns null when the model
// is not ready so the caller falls back to hand-authoring. Creates and
// destroys a session per call; batch callers should hold their own session.
export const runPrompt = async (
  input: string,
  options: {
    allowDownload?: boolean;
    signal?: AbortSignal;
    onDownloadProgress?: (loaded: number) => void;
    responseConstraint?: Record<string, unknown>;
  } = {},
): Promise<string | null> => {
  const model = getLanguageModel();
  if (!model) return null;
  const availability = await model.availability();
  if (availability !== "available" && !(options.allowDownload && availability === "downloadable")) {
    return null;
  }
  const createOptions: LanguageModelCreateOptions = {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onDownloadProgress
      ? {
          monitor: (monitor) => {
            monitor.addEventListener("downloadprogress", (event) => {
              options.onDownloadProgress?.(event.loaded);
            });
          },
        }
      : {}),
  };
  const session = await model.create(createOptions);
  try {
    const promptOptions = {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.responseConstraint ? { responseConstraint: options.responseConstraint } : {}),
    };
    return Object.keys(promptOptions).length > 0
      ? await session.prompt(input, promptOptions)
      : await session.prompt(input);
  } finally {
    session.destroy();
  }
};
