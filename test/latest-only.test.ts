import { createLatestOnly } from "../src/options/latest-only.ts";

describe("latest-only async results", () => {
  test("ignores a stale response that resolves after a newer one", async () => {
    const resolvers: Array<(value: string) => void> = [];
    const applied: string[] = [];
    const latest = createLatestOnly(
      () => new Promise<string>((resolve) => resolvers.push(resolve)),
      (value) => applied.push(value),
    );
    const old = latest.run();
    const current = latest.run();
    resolvers[1]("current result");
    await current;
    resolvers[0]("old result");
    await old;
    expect(applied).toEqual(["current result"]);
  });
});
