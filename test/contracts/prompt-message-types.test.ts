import { describe, expect, test } from "vitest";

import {
  isOffscreenPromptRequest,
  isOffscreenPromptResponse,
} from "../../src/shared/prompt-message-types.ts";

describe("offscreen prompt message runtime validation", () => {
  test("accepts prompt requests and terminal responses", () => {
    expect(isOffscreenPromptRequest({ type: "OFFSCREEN_PROMPT", input: "Suggest a rule" })).toBe(
      true,
    );
    expect(isOffscreenPromptResponse({ output: "into: images/" })).toBe(true);
    expect(isOffscreenPromptResponse({ output: null })).toBe(true);
    expect(isOffscreenPromptResponse({ error: "inference failed" })).toBe(true);
  });

  test.each([
    null,
    [],
    {},
    { type: "OFFSCREEN_PROMPT" },
    { type: "OFFSCREEN_PROMPT", input: 42 },
    { type: "OTHER", input: "Suggest a rule" },
  ])("rejects malformed prompt request %#", (value) => {
    expect(isOffscreenPromptRequest(value)).toBe(false);
  });

  test.each([
    null,
    [],
    {},
    { output: 42 },
    { output: undefined },
    { error: {} },
    { output: "rule", error: "failure" },
  ])("rejects malformed prompt response %#", (value) => {
    expect(isOffscreenPromptResponse(value)).toBe(false);
  });
});
