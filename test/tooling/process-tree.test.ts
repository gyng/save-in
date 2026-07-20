import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseProcessMemoryRows, sumProcessTreeRssKb, waitForExit } =
  require("../../scripts/lib/process-tree.js") as {
    parseProcessMemoryRows: (output: string) => Array<{
      pid: number;
      parentPid: number;
      rssKb: number;
    }>;
    sumProcessTreeRssKb: (
      rows: Array<{ pid: number; parentPid: number; rssKb: number }>,
      rootPid: number,
    ) => number;
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

test("parses process RSS rows and sums only the selected process tree", () => {
  const rows = parseProcessMemoryRows(`
      10       1     100
      11      10     200
      12      11     300
      20       1     900
  malformed row
  `);

  expect(rows).toEqual([
    { pid: 10, parentPid: 1, rssKb: 100 },
    { pid: 11, parentPid: 10, rssKb: 200 },
    { pid: 12, parentPid: 11, rssKb: 300 },
    { pid: 20, parentPid: 1, rssKb: 900 },
  ]);
  expect(sumProcessTreeRssKb(rows, 10)).toBe(600);
});

test("rejects an RSS snapshot taken after the root process exited", () => {
  expect(() => sumProcessTreeRssKb([], 10)).toThrow("Process 10 is absent");
});
