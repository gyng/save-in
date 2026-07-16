import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createReviewKeyHandler, promptRuntimeSettings } =
  require("../../scripts/review-demo.js") as {
    createReviewKeyHandler: (actions: {
      enableHotReload: () => void;
      openFirefox: () => void;
      reload: () => void;
      setTerminalFocused: (focused: boolean) => void;
      stop: () => void;
      togglePromptSupport: () => void;
    }) => (input: string) => void;
    promptRuntimeSettings: (
      runtimeRoot: string,
      environment?: NodeJS.ProcessEnv,
      exists?: (filename: string) => boolean,
    ) => { extraArgs: string[]; environment: NodeJS.ProcessEnv };
  };

describe("review demo server", () => {
  test("scopes WSLg ANGLE and Dozen settings to the Prompt browser", () => {
    const root = "/profiles/prompt-runtime";
    const settings = promptRuntimeSettings(
      root,
      { LD_LIBRARY_PATH: "/existing/lib", SAVE_IN_PROMPT_ADAPTER: "NVIDIA RTX" },
      () => true,
    );

    expect(settings).toEqual({
      extraArgs: ["--use-angle=gl"],
      environment: {
        GALLIUM_DRIVER: "d3d12",
        MESA_D3D12_DEFAULT_ADAPTER_NAME: "NVIDIA RTX",
        VK_DRIVER_FILES: join(root, "share", "vulkan", "icd.d", "dzn_icd.json"),
        VK_INSTANCE_LAYERS: "VK_LAYER_LOCAL_compute_feature",
        VK_LAYER_PATH: join(root, "layer"),
        LD_LIBRARY_PATH: `${join(root, "lib")}:/usr/lib/wsl/lib:/existing/lib`,
      },
    });
  });

  test("rejects an incomplete Prompt review runtime before launching Chrome", () => {
    expect(() => promptRuntimeSettings("/missing/runtime", {}, () => false)).toThrow(
      /libvulkan_dzn\.so.*libvulkan-feature-shim\.so/,
    );
  });

  test("reloads on r or R and ignores unrelated input", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const togglePromptSupport = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
      togglePromptSupport,
    });

    handleKey("rxR");

    expect(reload).toHaveBeenCalledTimes(2);
    expect(enableHotReload).not.toHaveBeenCalled();
    expect(openFirefox).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(togglePromptSupport).not.toHaveBeenCalled();
  });

  test("enables hot reload on h or H", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const togglePromptSupport = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
      togglePromptSupport,
    });

    handleKey("hH");

    expect(enableHotReload).toHaveBeenCalledTimes(2);
    expect(openFirefox).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(togglePromptSupport).not.toHaveBeenCalled();
  });

  test("opens Firefox on f or F", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const togglePromptSupport = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
      togglePromptSupport,
    });

    handleKey("fF");

    expect(openFirefox).toHaveBeenCalledTimes(2);
    expect(enableHotReload).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(togglePromptSupport).not.toHaveBeenCalled();
  });

  test("toggles Prompt support on p or P", () => {
    const togglePromptSupport = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload: vi.fn(),
      openFirefox: vi.fn(),
      reload: vi.fn(),
      setTerminalFocused: vi.fn(),
      stop: vi.fn(),
      togglePromptSupport,
    });

    handleKey("pP");

    expect(togglePromptSupport).toHaveBeenCalledTimes(2);
  });

  test("tracks terminal focus and treats keyboard input as active", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const togglePromptSupport = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
      togglePromptSupport,
    });

    handleKey("\u001B[O");
    handleKey("\u001B[I");
    handleKey("x");

    expect(setTerminalFocused.mock.calls).toEqual([[false], [true], [true]]);
    expect(enableHotReload).not.toHaveBeenCalled();
    expect(openFirefox).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(togglePromptSupport).not.toHaveBeenCalled();
  });

  test("stops on Ctrl+C without processing later input", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const togglePromptSupport = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
      togglePromptSupport,
    });

    handleKey(`r\u0003f`);

    expect(reload).toHaveBeenCalledOnce();
    expect(openFirefox).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    expect(togglePromptSupport).not.toHaveBeenCalled();
  });
});
