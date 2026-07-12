import { createLatestTaskRunner } from "../src/options/latest-task.ts";

test("serializes work and coalesces queued values to the latest", async () => {
  const releases: Array<() => void> = [];
  const seen: string[] = [];
  const runner = createLatestTaskRunner<string>(
    (value) =>
      new Promise<void>((resolve) => {
        seen.push(value);
        releases.push(resolve);
      }),
  );

  runner.schedule("a");
  runner.schedule("b");
  runner.schedule("c");
  expect(seen).toEqual(["a"]);

  releases.shift()!();
  await vi.waitFor(() => expect(seen).toEqual(["a", "c"]));
  releases.shift()!();
  await runner.idle();
  expect(runner.isRunning()).toBe(false);
});

test("continues with the latest value after a failed task", async () => {
  const seen: string[] = [];
  const runner = createLatestTaskRunner<string>(async (value) => {
    seen.push(value);
    if (value === "a") throw new Error("offline");
  });
  runner.schedule("a");
  runner.schedule("b");
  await runner.idle();
  expect(seen).toEqual(["a", "b"]);
});
