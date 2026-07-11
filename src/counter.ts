export const COUNTER_KEY = "save-in-counter";

export type CounterWriteState = {
  queue: Promise<unknown>;
};

export const nextCounter = (writes: CounterWriteState, storage): Promise<number> => {
  const result = writes.queue
    .then(() => storage.get(COUNTER_KEY))
    .then((stored) => {
      const value: number = ((stored && stored[COUNTER_KEY]) || 0) + 1;
      return storage.set({ [COUNTER_KEY]: value }).then(() => value);
    });
  writes.queue = result;
  return result;
};

export const peekCounter = (storage): Promise<number> =>
  storage.get(COUNTER_KEY).then((stored) => (stored && stored[COUNTER_KEY]) || 0);

export const resetCounter = (writes: CounterWriteState, storage) => {
  writes.queue = writes.queue.then(() => storage.set({ [COUNTER_KEY]: 0 }));
  return writes.queue;
};
