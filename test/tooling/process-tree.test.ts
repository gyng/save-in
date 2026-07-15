import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { waitForExit } = require("../../scripts/lib/process-tree.js") as {
  waitForExit: (exited: Promise<unknown>, timeoutMs: number) => Promise<boolean>;
};

afterEach(() => vi.useRealTimers());

test("clears the termination deadline when a process exits early", async () => {
  vi.useFakeTimers();

  await expect(waitForExit(Promise.resolve(), 5_000)).resolves.toBe(true);

  expect(vi.getTimerCount()).toBe(0);
});

test("reports a process that remains alive at the deadline", async () => {
  vi.useFakeTimers();
  const waiting = waitForExit(new Promise(() => {}), 5_000);

  await vi.advanceTimersByTimeAsync(5_000);

  await expect(waiting).resolves.toBe(false);
});
