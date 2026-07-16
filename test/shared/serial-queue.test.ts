import { createSerialQueue } from "../../src/shared/serial-queue.ts";

test("runs tasks one at a time in enqueue order and returns each task's result", async () => {
  const queue = createSerialQueue();
  const log: string[] = [];

  const a = queue.enqueue(async () => {
    log.push("a:start");
    await Promise.resolve();
    log.push("a:end");
    return 1;
  });
  const b = queue.enqueue(async () => {
    log.push("b");
    return 2;
  });

  await expect(a).resolves.toBe(1);
  await expect(b).resolves.toBe(2);
  // b never interleaves with a
  expect(log).toEqual(["a:start", "a:end", "b"]);
});

test("a rejected task neither blocks nor poisons the tasks queued behind it", async () => {
  const queue = createSerialQueue();
  const log: string[] = [];

  const failing = queue.enqueue(async () => {
    log.push("fail");
    throw new Error("boom");
  });
  const following = queue.enqueue(async () => {
    log.push("after");
    return "ok";
  });

  await expect(failing).rejects.toThrow("boom");
  await expect(following).resolves.toBe("ok");
  expect(log).toEqual(["fail", "after"]);
});

test("settled resolves after the queued work drains and never rejects", async () => {
  const queue = createSerialQueue();
  let done = false;

  queue.enqueue(async () => {
    throw new Error("ignored");
  });
  const flush = queue.enqueue(async () => {
    await Promise.resolve();
    done = true;
  });

  flush.catch(() => {});
  await expect(queue.settled()).resolves.toBeUndefined();
  expect(done).toBe(true);
});
