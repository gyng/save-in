export const createLatestTaskRunner = <T>(run: (value: T) => Promise<void>) => {
  let pending: { value: T } | null = null;
  let active: Promise<void> | null = null;

  const drain = async () => {
    while (pending) {
      const { value } = pending;
      pending = null;
      try {
        await run(value);
      } catch {
        // A failed attempt must not discard a newer value queued behind it.
      }
    }
  };
  const start = () => {
    if (active) return;
    active = drain().finally(() => {
      active = null;
      // A microtask can queue a value after drain's last check but before
      // this active task retires. That value still needs its own drain.
      if (pending) start();
    });
  };
  const idle = async (): Promise<void> => {
    const task = active;
    if (!task) return;
    await task;
    return idle();
  };

  return {
    schedule(value: T) {
      pending = { value };
      start();
    },
    isRunning: () => active !== null,
    idle,
  };
};
