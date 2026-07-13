export const runEventTask = (
  work: () => unknown,
  reportError: (error: unknown) => unknown,
): Promise<void> => {
  const report = (error: unknown): Promise<void> => {
    try {
      return Promise.resolve(reportError(error))
        .then(() => undefined)
        .catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  };

  try {
    // Preserve browser-listener behavior that runs synchronously before its
    // first await; only the rejection boundary is new.
    return Promise.resolve(work()).then(() => undefined, report);
  } catch (error) {
    return report(error);
  }
};
