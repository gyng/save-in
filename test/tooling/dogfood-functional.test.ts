import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { milliseconds, parseArgs } = require("../../scripts/dogfood-functional.js") as {
  milliseconds(value: number): string;
  parseArgs(argv: string[]): {
    watch: boolean;
    headed: boolean;
    stage: boolean;
    requireWebMcp: boolean;
  };
};

describe("functional dogfood CLI", () => {
  test("uses the isolated fast-path defaults", () => {
    expect(parseArgs([])).toEqual({
      watch: false,
      headed: false,
      stage: true,
      requireWebMcp: true,
    });
  });

  test("supports persistent and diagnostic overrides", () => {
    expect(parseArgs(["--watch", "--headed", "--no-stage", "--allow-no-webmcp"])).toEqual({
      watch: true,
      headed: true,
      stage: false,
      requireWebMcp: false,
    });
  });

  test("rejects misspelled options instead of silently running the wrong mode", () => {
    expect(() => parseArgs(["--wacth"])).toThrow("Unknown dogfood option: --wacth");
  });

  test("formats measured timings consistently", () => {
    expect(milliseconds(10.6)).toBe("11 ms");
  });
});
