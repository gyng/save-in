import { describe, expect, it } from "vitest";
import { createDownloadRuntimeState } from "../src/downloads/download-runtime-state.ts";
import type { DownloadPipelineState } from "../src/downloads/download-types.ts";
import { Path } from "../src/routing/path.ts";

const stateFor = (url: string): DownloadPipelineState => ({
  path: new Path("."),
  info: { url },
  scratch: {},
});

describe("download runtime state", () => {
  it("moves a pending state without changing its identity", () => {
    const runtime = createDownloadRuntimeState();
    const state = stateFor("https://example.test/original");
    runtime.rememberPendingState(state);
    runtime.movePendingState(state, "blob:replacement");
    expect(runtime.pendingStates.has(state.info.url!)).toBe(false);
    expect(runtime.pendingStates.get("blob:replacement")).toEqual([state]);
  });

  it("bounds pending correlations across URLs", () => {
    const runtime = createDownloadRuntimeState();
    for (let index = 0; index < 60; index += 1) {
      runtime.rememberPendingState(stateFor(`https://example.test/${index}`));
    }
    expect([...runtime.pendingStates.values()].flat()).toHaveLength(50);
  });

  it("ignores empty URLs and leaves unrelated queued states intact", () => {
    const runtime = createDownloadRuntimeState();
    const first = stateFor("https://example.test/shared");
    const second = stateFor("https://example.test/shared");
    const absent = stateFor("https://example.test/absent");

    runtime.rememberPendingStateAtUrl(first, "");
    runtime.rememberPendingState({ path: new Path("."), info: {}, scratch: {} });
    runtime.rememberPendingState(first);
    runtime.forgetPendingState(absent);
    expect(runtime.pendingStates.get(first.info.url!)).toEqual([first]);

    runtime.rememberPendingState(second);
    runtime.forgetPendingState(first);
    expect(runtime.pendingStates.get(second.info.url!)).toEqual([second]);
  });
});
