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
      promptRuntime: () => { extraArgs: string[]; environment: Record<string, string> } | null,
    ): {
      profileDir: string;
      preserve: boolean;
      enableGpu: boolean;
      extraArgs: string[];
      environment: Record<string, string>;
    };
  };

const runtime = {
  extraArgs: ["--use-angle=gl"],
  environment: { VK_DRIVER_FILES: "/runtime/icd.json" },
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
    expect(selectDogfoodProfile(true, "/profiles/nano", exists, () => runtime)).toEqual({
      profileDir: "/profiles/nano",
      preserve: true,
      enableGpu: true,
      ...runtime,
    });
    expect(selectDogfoodProfile(false, "/profiles/nano", exists, () => runtime)).toEqual({
      profileDir: expect.stringMatching(/[\\/]dist[\\/]dogfood-profile$/),
      preserve: false,
      enableGpu: false,
      extraArgs: [],
      environment: {},
    });
  });

  test("keeps the on-device profile out of a launch that lacks its runtime", () => {
    const exists = (profile: string) => profile === "/profiles/nano";

    // ChromeML cannot reach a device without the provisioned runtime, so the
    // model process crashes and Chrome disables the model for that profile.
    // Falling back keeps a headed round from poisoning the shared profile.
    expect(selectDogfoodProfile(true, "/profiles/nano", exists, () => null)).toEqual({
      profileDir: expect.stringMatching(/[\\/]dist[\\/]dogfood-profile$/),
      preserve: false,
      enableGpu: false,
      extraArgs: [],
      environment: {},
    });
  });

  test("rejects misspelled options instead of silently running the wrong mode", () => {
    expect(() => parseArgs(["--wacth"])).toThrow("Unknown dogfood option: --wacth");
  });

  test("formats measured timings consistently", () => {
    expect(milliseconds(10.6)).toBe("11 ms");
  });
});
