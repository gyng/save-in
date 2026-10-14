import { navigationVisitStart, trackPageVisit } from "../../src/content/page-visit.ts";

const fakeWindow = (now: number, entries: unknown[]) =>
  Object.assign(new EventTarget(), {
    performance: {
      now: () => now,
      getEntriesByType: (type: string) => (type === "navigation" ? entries : []),
    } as unknown as Performance,
  });

const transition = (type: string, persisted: boolean) =>
  Object.assign(new Event(type), { persisted });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("navigationVisitStart", () => {
  test.each<[string, unknown[], number]>([
    // 500 ms into the document, whose response began 300 ms in.
    ["the response start on the wall clock", [{ responseStart: 300 }], 9_800],
    ["the navigation start without a navigation entry", [], 9_500],
    ["the navigation start for an unusable response start", [{ responseStart: "300" }], 9_500],
    ["the navigation start for a zero response start", [{ responseStart: 0 }], 9_500],
  ])("is %s", (_label, entries, expected) => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    expect(navigationVisitStart(fakeWindow(500, entries))).toBe(expected);
  });
});

describe("trackPageVisit", () => {
  test("starts a new visit on a back/forward restore and is hidden in between", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    const win = fakeWindow(500, [{ responseStart: 300 }]);
    const visit = trackPageVisit(win);
    expect(visit.start()).toBe(9_800);
    expect(visit.hidden()).toBe(false);

    win.dispatchEvent(transition("pagehide", true));
    expect(visit.hidden()).toBe(true);

    vi.spyOn(Date, "now").mockReturnValue(60_000);
    win.dispatchEvent(transition("pageshow", true));
    expect(visit.hidden()).toBe(false);
    expect(visit.start()).toBe(60_000);
  });

  test("keeps the visit on an ordinary pageshow", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    const win = fakeWindow(500, []);
    const visit = trackPageVisit(win);
    vi.spyOn(Date, "now").mockReturnValue(60_000);
    win.dispatchEvent(transition("pageshow", false));
    expect(visit.start()).toBe(9_500);
  });
});
