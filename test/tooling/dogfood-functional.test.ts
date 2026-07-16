import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { milliseconds, parseArgs, selectDogfoodProfile } =
  require("../../scripts/dogfood-functional.js") as {
    milliseconds(value: number): string;
    parseArgs(argv: string[]): {
      watch: boolean;
      headed: boolean;
      stage: boolean;
      requireWebMcp: boolean;
      requirePromptApi: boolean;
    };
    selectDogfoodProfile(
      headed: boolean,
      promptProfile: string,
      profileExists: (profile: string) => boolean,
    ): { profileDir: string; preserve: boolean; enableGpu: boolean };
  };

describe("functional dogfood CLI", () => {
  test("uses the isolated fast-path defaults", () => {
    expect(parseArgs([])).toEqual({
      watch: false,
      headed: false,
      stage: true,
      requireWebMcp: true,
      requirePromptApi: true,
    });
  });

  test("supports persistent and diagnostic overrides", () => {
    expect(
      parseArgs([
        "--watch",
        "--headed",
        "--no-stage",
        "--allow-no-webmcp",
        "--allow-no-prompt-api",
      ]),
    ).toEqual({
      watch: true,
      headed: true,
      stage: false,
      requireWebMcp: false,
      requirePromptApi: false,
    });
  });

  test("preserves a provisioned profile only for headed dogfood", () => {
    const exists = vi.fn(() => true);
    expect(selectDogfoodProfile(true, "/profiles/nano", exists)).toEqual({
      profileDir: "/profiles/nano",
      preserve: true,
      enableGpu: true,
    });
    expect(selectDogfoodProfile(false, "/profiles/nano", exists)).toEqual({
      profileDir: expect.stringMatching(/[\\/]dist[\\/]dogfood-profile$/),
      preserve: false,
      enableGpu: false,
    });
  });

  test("rejects misspelled options instead of silently running the wrong mode", () => {
    expect(() => parseArgs(["--wacth"])).toThrow("Unknown dogfood option: --wacth");
  });

  test("formats measured timings consistently", () => {
    expect(milliseconds(10.6)).toBe("11 ms");
  });
});
