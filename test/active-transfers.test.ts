import { ActiveTransfers } from "../src/downloads/active-transfers.ts";

afterEach(() => ActiveTransfers.clear());

test("cancels an active preparation by its history ID", () => {
  const controller = new AbortController();
  ActiveTransfers.register("h1", controller);

  expect(ActiveTransfers.cancel("h1")).toBe(true);
  expect(controller.signal.aborted).toBe(true);
});

test("finishing an old controller does not remove its replacement", () => {
  const first = new AbortController();
  const second = new AbortController();
  ActiveTransfers.register("h1", first);
  ActiveTransfers.register("h1", second);
  ActiveTransfers.finish("h1", first);

  expect(first.signal.aborted).toBe(true);
  expect(ActiveTransfers.cancel("h1")).toBe(true);
  expect(second.signal.aborted).toBe(true);
});
