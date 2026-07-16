// platform/offscreen-client.ts and offscreen/offscreen.ts are peer execution
// contexts that share this runtime-validated message boundary.

import { MESSAGE_TYPES } from "./constants.ts";

export type OffscreenPromptRequest = {
  type: typeof MESSAGE_TYPES.OFFSCREEN_PROMPT;
  input: string;
};

export type OffscreenPromptResponse =
  | { output: string | null; error?: never }
  | { output?: never; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isOffscreenPromptRequest = (value: unknown): value is OffscreenPromptRequest =>
  isRecord(value) &&
  value.type === MESSAGE_TYPES.OFFSCREEN_PROMPT &&
  typeof value.input === "string";

export const isOffscreenPromptResponse = (value: unknown): value is OffscreenPromptResponse => {
  if (!isRecord(value)) return false;
  if (typeof value.error === "string") {
    return typeof value.output === "undefined";
  }
  return (
    (typeof value.output === "string" || value.output === null) &&
    typeof value.error === "undefined"
  );
};
