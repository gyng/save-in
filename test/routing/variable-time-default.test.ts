import { Path } from "../../src/routing/path.ts";
import type { RoutingDownloadInfo } from "../../src/routing/rule-types.ts";
import { applyVariables } from "../../src/routing/variable.ts";

describe("routing variable timestamp defaults", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T03:04:05.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  test.each([undefined, new Date(Number.NaN)])(
    "establishes one valid timestamp for %p",
    async (now) => {
      const info: RoutingDownloadInfo = { now };
      const path = new Path(":isodate:/:unixdate:");

      await expect(applyVariables(path, info)).resolves.toBe(path);

      expect(path.finalize()).toBe("20260715T030405Z/1784084645");
      expect(info.now?.toISOString()).toBe("2026-07-15T03:04:05.000Z");
    },
  );
});
