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
  prompt: (input: string) => Promise<string>;
  destroy: () => void;
};

type LanguageModelStatic = {
  availability: () => Promise<PromptAvailability>;
  create: (options?: unknown) => Promise<LanguageModelSession>;
};

// The global is a platform declaration gap (not in the TS lib). Read it as
// unknown and narrow before use; the final assertion is a checked boundary.
const getLanguageModel = (): LanguageModelStatic | null => {
  const candidate: unknown = Reflect.get(globalThis, "LanguageModel");
  if (
    typeof candidate === "object" &&
    candidate !== null &&
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
  options: { allowDownload?: boolean } = {},
): Promise<string | null> => {
  const model = getLanguageModel();
  if (!model) return null;
  const availability = await model.availability();
  if (availability !== "available" && !(options.allowDownload && availability === "downloadable")) {
    return null;
  }
  const session = await model.create();
  try {
    return await session.prompt(input);
  } finally {
    session.destroy();
  }
};
