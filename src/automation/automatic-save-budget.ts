import { isStringKeyedRecord, withUrl } from "../shared/util.ts";

// The page-visit limit on automatic saves is counted by the content script,
// and a page gets a fresh content script every time it loads. A hostile page a
// rule matches could therefore serve new matching addresses and reload itself
// in a loop, collecting the full per-visit allowance each time. This budget is
// the background's own count, which a reload does not reset: per tab and page
// origin, at most a small multiple of the per-visit limit within a rolling
// window. Paging through a gallery stays well inside it; a reload loop does not.
const AUTOMATIC_BUDGET_PAGE_MULTIPLE = 3;
export const AUTOMATIC_BUDGET_WINDOW_MS = 10 * 60 * 1000;
// Tabs and origins come and go; the record must not grow with them.
const AUTOMATIC_BUDGET_KEY_LIMIT = 64;

// Two adjacent fixed windows approximate a rolling one in constant space: the
// previous window counts in proportion to how much of it the rolling window
// still covers. Holds no address, only counts.
type BudgetEntry = {
  start: number;
  count: number;
  previous: number;
  // One debug-log line per window, not one per refused candidate.
  logged: boolean;
};

export type AutomaticBudgetState = Record<string, BudgetEntry>;

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isBudgetEntry = (value: unknown): value is BudgetEntry =>
  isStringKeyedRecord(value) &&
  isCount(value.start) &&
  isCount(value.count) &&
  isCount(value.previous) &&
  typeof value.logged === "boolean";

const freshEntry = (now: number): BudgetEntry => ({
  start: now,
  count: 0,
  previous: 0,
  logged: false,
});

// The entry as it stands at `now`. A clock that moved backwards starts over:
// a start in the future would otherwise hold its count indefinitely.
const rolled = (entry: BudgetEntry | undefined, now: number): BudgetEntry => {
  if (!entry || now < entry.start) return freshEntry(now);
  const age = now - entry.start;
  if (age < AUTOMATIC_BUDGET_WINDOW_MS) return entry;
  if (age < 2 * AUTOMATIC_BUDGET_WINDOW_MS) {
    return {
      start: entry.start + AUTOMATIC_BUDGET_WINDOW_MS,
      count: 0,
      previous: entry.count,
      logged: false,
    };
  }
  return freshEntry(now);
};

const used = (entry: BudgetEntry, now: number): number =>
  entry.count + entry.previous * (1 - (now - entry.start) / AUTOMATIC_BUDGET_WINDOW_MS);

// Stored entries that still mean something at `now`, without `key`. Anything
// malformed is dropped: session storage is emptied by an extension reload, so
// no older version's shape can be here, only damage.
const liveEntries = (stored: unknown, key: string, now: number): Array<[string, BudgetEntry]> =>
  isStringKeyedRecord(stored)
    ? Object.entries(stored).flatMap(([storedKey, value]): Array<[string, BudgetEntry]> => {
        if (storedKey === key || !isBudgetEntry(value)) return [];
        const entry = rolled(value, now);
        return entry.count > 0 || entry.previous > 0 ? [[storedKey, entry]] : [];
      })
    : [];

const withEntry = (
  stored: unknown,
  key: string,
  entry: BudgetEntry,
  now: number,
): AutomaticBudgetState =>
  Object.fromEntries([
    ...liveEntries(stored, key, now)
      .toSorted(([, a], [, b]) => b.start - a.start)
      .slice(0, AUTOMATIC_BUDGET_KEY_LIMIT - 1),
    [key, entry],
  ]);

const storedEntry = (stored: unknown, key: string): BudgetEntry | undefined => {
  const value = isStringKeyedRecord(stored) ? stored[key] : undefined;
  return isBudgetEntry(value) ? value : undefined;
};

// A private tab's page origin is not written anywhere: its budget is per tab
// alone, which is stricter and identifies nothing. A regular tab's key holds
// the origin so that moving to another site in the same tab starts afresh.
export const automaticBudgetKey = (tab: {
  id?: number | undefined;
  url?: string | undefined;
  incognito?: boolean | undefined;
}): string => {
  const origin = tab.incognito === true ? "" : withUrl(tab.url ?? "", (url) => url.origin, "");
  return `${typeof tab.id === "number" ? tab.id : ""}|${origin}`;
};

export const automaticBudgetLimit = (maxPerPage: number): number =>
  maxPerPage * AUTOMATIC_BUDGET_PAGE_MULTIPLE;

export type AutomaticBudgetReservation = {
  state: AutomaticBudgetState;
  allowed: boolean;
  // True for the first refusal in a window, so the caller logs it once.
  firstRefusal: boolean;
};

// Counts one automatic save against `key` if the budget has room. The count is
// taken before the save launches so that concurrent candidates cannot all pass
// on the same reading; a save that then does not launch is refunded.
export const reserveAutomaticSave = (
  stored: unknown,
  key: string,
  limit: number,
  now: number,
): AutomaticBudgetReservation => {
  const entry = rolled(storedEntry(stored, key), now);
  const allowed = used(entry, now) + 1 <= limit;
  const next = allowed ? { ...entry, count: entry.count + 1 } : { ...entry, logged: true };
  return {
    state: withEntry(stored, key, next, now),
    allowed,
    firstRefusal: !allowed && !entry.logged,
  };
};

export const refundAutomaticSave = (
  stored: unknown,
  key: string,
  now: number,
): AutomaticBudgetState => {
  const entry = rolled(storedEntry(stored, key), now);
  // The window may have rolled between the reservation and its refund.
  const next =
    entry.count > 0
      ? { ...entry, count: entry.count - 1 }
      : { ...entry, previous: Math.max(0, entry.previous - 1) };
  return withEntry(stored, key, next, now);
};
