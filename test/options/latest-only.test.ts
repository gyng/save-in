import { createLatestOnly } from "../../src/options/latest-only.ts";

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
    resolvers[1]!("current result");
    await current;
    resolvers[0]!("old result");
    await old;
    expect(applied).toEqual(["current result"]);
  });
});

test("only reports a rejection from the latest request", async () => {
  const rejecters: Array<(reason: Error) => void> = [];
  const failures: string[] = [];
  const latest = createLatestOnly(
    () => new Promise<string>((_resolve, reject) => rejecters.push(reject)),
    () => {},
    (error) => failures.push(String(error)),
  );
  const old = latest.run();
  const current = latest.run();
  rejecters[0]!(new Error("old"));
  await old;
  rejecters[1]!(new Error("current"));
  await current;
  expect(failures).toEqual(["Error: current"]);
});
