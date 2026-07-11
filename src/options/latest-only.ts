export const createLatestOnly = <Args extends unknown[], Result>(
  request: (...args: Args) => Promise<Result>,
  apply: (result: Result) => void,
  reject?: (error: unknown, ...args: Args) => void,
) => {
  let generation = 0;
  return {
    run: async (...args: Args): Promise<boolean> => {
      const mine = ++generation;
      try {
        const result = await request(...args);
        if (mine !== generation) return false;
        apply(result);
        return true;
      } catch (error) {
        if (mine === generation) reject?.(error, ...args);
        return false;
      }
    },
  };
};
