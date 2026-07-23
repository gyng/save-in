import type { DownloadPipelineState } from "../../src/downloads/download-types.ts";
import {
  discardRoutingResolution,
  prepareRoutingResolution,
  settleRoutingResolution,
  waitForRoutingResolution,
} from "../../src/downloads/routing-resolution.ts";

const makeState = (required = true): DownloadPipelineState => ({
  path: { finalize: () => "downloads", toString: () => "downloads" },
  scratch: required ? { deferredRoutingResolution: true } : {},
  info: {},
});

test("is inert when final-filename routing cannot change the settled route", async () => {
  const state = makeState(false);
  prepareRoutingResolution(state);
  settleRoutingResolution(state);
  await expect(waitForRoutingResolution(state)).resolves.toBeUndefined();
});

test("coalesces preparation and releases the caller when filename routing settles", async () => {
  const state = makeState();
  prepareRoutingResolution(state);
  prepareRoutingResolution(state);
  let finished = false;
  const waiting = waitForRoutingResolution(state).then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);

  settleRoutingResolution(state);
  await waiting;
  expect(finished).toBe(true);
  expect(state.scratch.deferredRoutingResolution).toBeUndefined();
  settleRoutingResolution(state);
});

test("discards a prepared acknowledgement after a failed browser handoff", async () => {
  const state = makeState();
  prepareRoutingResolution(state);
  discardRoutingResolution(state);

  expect(state.scratch.deferredRoutingResolution).toBeUndefined();
  await expect(waitForRoutingResolution(state)).resolves.toBeUndefined();
});
