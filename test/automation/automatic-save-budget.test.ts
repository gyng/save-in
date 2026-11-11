import {
  AUTOMATIC_BUDGET_WINDOW_MS,
  automaticBudgetKey,
  automaticBudgetLimit,
  refundAutomaticSave,
  reserveAutomaticSave,
} from "../../src/automation/automatic-save-budget.ts";

const WINDOW = AUTOMATIC_BUDGET_WINDOW_MS;
const START = 1_800_000_000_000;

const reserveMany = (stored: unknown, key: string, limit: number, now: number, times: number) => {
  let state = stored;
  let allowed = 0;
  let firstRefusals = 0;
  for (let index = 0; index < times; index += 1) {
    const reservation = reserveAutomaticSave(state, key, limit, now);
    state = reservation.state;
    if (reservation.allowed) allowed += 1;
    if (reservation.firstRefusal) firstRefusals += 1;
  }
  return { state, allowed, firstRefusals };
};

describe("automatic save budget", () => {
  test("is three page visits' worth of saves in ten minutes", () => {
    expect(WINDOW).toBe(10 * 60 * 1000);
    expect(automaticBudgetLimit(20)).toBe(60);
    expect(automaticBudgetLimit(1)).toBe(3);
    expect(automaticBudgetLimit(500)).toBe(1500);
  });

  test("allows saves up to the limit and refuses the rest of the window", () => {
    const { state, allowed, firstRefusals } = reserveMany(
      undefined,
      "7|https://a.test",
      60,
      START,
      100,
    );

    expect(allowed).toBe(60);
    // One log line for the window, however many candidates it refuses.
    expect(firstRefusals).toBe(1);
    expect(reserveAutomaticSave(state, "7|https://a.test", 60, START + WINDOW - 1).allowed).toBe(
      false,
    );
  });

  test("each tab and origin has its own budget", () => {
    const { state } = reserveMany(undefined, "7|https://a.test", 3, START, 10);

    expect(reserveAutomaticSave(state, "7|https://b.test", 3, START).allowed).toBe(true);
    expect(reserveAutomaticSave(state, "8|https://a.test", 3, START).allowed).toBe(true);
    expect(reserveAutomaticSave(state, "7|https://a.test", 3, START).allowed).toBe(false);
  });

  test("the window rolls: room returns gradually, not all at once at a boundary", () => {
    const key = "7|https://a.test";
    const full = reserveMany(undefined, key, 60, START, 60).state;

    // Just past the first window everything saved in it still counts.
    expect(reserveAutomaticSave(full, key, 60, START + WINDOW).allowed).toBe(false);
    // Halfway through the next, half of it has aged out.
    const halfway = reserveMany(full, key, 60, START + WINDOW * 1.5, 100);
    expect(halfway.allowed).toBe(30);
    expect(halfway.firstRefusals).toBe(1);
    // Two windows on, nothing from the burst remains.
    expect(reserveMany(full, key, 60, START + WINDOW * 2, 100).allowed).toBe(60);
  });

  test("a new window logs its first refusal again", () => {
    const key = "7|https://a.test";
    const first = reserveMany(undefined, key, 2, START, 5);
    const second = reserveMany(first.state, key, 2, START + WINDOW * 2, 5);

    expect(first.firstRefusals).toBe(1);
    expect(second.firstRefusals).toBe(1);
  });

  test("a save that did not launch is refunded", () => {
    const key = "7|https://a.test";
    const full = reserveMany(undefined, key, 3, START, 3).state;
    expect(reserveAutomaticSave(full, key, 3, START).allowed).toBe(false);

    const refunded = refundAutomaticSave(full, key, START);

    expect(reserveAutomaticSave(refunded, key, 3, START).allowed).toBe(true);
    // Refunding with nothing reserved never goes below zero.
    const empty = refundAutomaticSave(refundAutomaticSave(undefined, key, START), key, START);
    expect(reserveMany(empty, key, 3, START, 10).allowed).toBe(3);
  });

  test("a refund after the window rolled comes off the earlier window", () => {
    const key = "7|https://a.test";
    const full = reserveMany(undefined, key, 4, START, 4).state;

    const refunded = refundAutomaticSave(full, key, START + WINDOW);

    expect(refunded[key]).toMatchObject({ count: 0, previous: 3 });
    expect(reserveAutomaticSave(refunded, key, 4, START + WINDOW).allowed).toBe(true);
    expect(reserveAutomaticSave(full, key, 4, START + WINDOW).allowed).toBe(false);
  });

  test("a clock that moved backwards starts the entry over", () => {
    const key = "7|https://a.test";
    const full = reserveMany(undefined, key, 3, START, 3).state;

    expect(reserveMany(full, key, 3, START - 5 * WINDOW, 10).allowed).toBe(3);
  });

  test("tracks a bounded number of tabs and origins, dropping the oldest", () => {
    let state: unknown;
    for (let index = 0; index < 200; index += 1) {
      state = reserveAutomaticSave(state, `${index}|https://a.test`, 3, START + index).state;
    }
    const keys = Object.keys(state as object);

    expect(keys).toHaveLength(64);
    expect(keys).toContain("199|https://a.test");
    expect(keys).not.toContain("0|https://a.test");
  });

  test("forgets entries whose windows have passed", () => {
    const state = reserveMany(undefined, "7|https://a.test", 3, START, 3).state;

    const later = reserveAutomaticSave(state, "8|https://b.test", 3, START + WINDOW * 2).state;

    expect(Object.keys(later)).toEqual(["8|https://b.test"]);
  });

  test.each([
    ["not a record", "damaged"],
    ["a list", [1, 2, 3]],
    ["null", null],
    [
      "malformed entries",
      {
        "7|https://a.test": { start: START, count: "many", previous: 0, logged: false },
        "8|https://a.test": { start: START, count: -1, previous: 0, logged: false },
        "9|https://a.test": { start: START, count: 99, previous: 0 },
        "10|https://a.test": null,
        "11|https://a.test": { start: "then", count: 1, previous: 0, logged: false },
        "12|https://a.test": { start: START, count: 1, previous: 1.5, logged: false },
      },
    ],
  ])("reads %s as an empty record", (_label, stored) => {
    const { state, allowed } = reserveMany(stored, "7|https://a.test", 3, START, 10);

    expect(allowed).toBe(3);
    expect(Object.keys(state as object)).toEqual(["7|https://a.test"]);
    expect(Object.keys(refundAutomaticSave(stored, "7|https://a.test", START))).toEqual([
      "7|https://a.test",
    ]);
  });

  test("the key names a tab and its page origin, and nothing else of the address", () => {
    expect(
      automaticBudgetKey({ id: 7, url: "https://user:pw@a.test:8443/gallery/1?token=secret#x" }),
    ).toBe("7|https://a.test:8443");
    expect(automaticBudgetKey({ id: 7, url: "http://a.test/" })).toBe("7|http://a.test");
    expect(automaticBudgetKey({ id: 7, url: "not a url" })).toBe("7|");
    expect(automaticBudgetKey({ id: 7 })).toBe("7|");
    expect(automaticBudgetKey({ url: "https://a.test/" })).toBe("|https://a.test");
  });

  test("a private tab's key holds no origin", () => {
    expect(automaticBudgetKey({ id: 7, url: "https://secret.test/x", incognito: true })).toBe("7|");
    expect(automaticBudgetKey({ id: 7, url: "https://a.test/x", incognito: false })).toBe(
      "7|https://a.test",
    );
  });
});
