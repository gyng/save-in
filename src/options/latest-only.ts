export const createLatestOnly = <Args extends unknown[], Result>(
  request: (...args: Args) => Promise<Result>,
  apply: (result: Result) => void,
) => {
  let generation = 0;
  return {
    run: async (...args: Args): Promise<boolean> => {
      const mine = ++generation;
      const result = await request(...args);
      if (mine !== generation) return false;
      apply(result);
      return true;
    },
  };
};
