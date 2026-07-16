// A single-lane async queue: tasks run one at a time in enqueue order, and a
// task's rejection never blocks or poisons the tasks queued behind it. This
// replaces the hand-rolled "chain onto a promise tail, swallow prior errors"
// idiom that several background and options modules had each re-implemented.
export interface SerialQueue {
  // Run `task` after every previously enqueued task has settled. The returned
  // promise resolves or rejects with `task`'s own outcome; a rejection here does
  // not affect later tasks.
  enqueue: <T>(task: () => Promise<T>) => Promise<T>;
  // Resolve once the currently-queued work has settled. Never rejects, so it is
  // safe to `await` before reading shared state the queue guards.
  settled: () => Promise<void>;
}

export const createSerialQueue = (): SerialQueue => {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue: <T>(task: () => Promise<T>): Promise<T> => {
      // Run regardless of whether the previous task fulfilled or rejected, and
      // keep the tail a never-rejecting void promise so failures stay isolated.
      const run = tail.then(task, task);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    settled: (): Promise<void> =>
      tail.then(
        () => undefined,
        () => undefined,
      ),
  };
};
