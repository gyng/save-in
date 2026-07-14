import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createReviewKeyHandler } = require("../../scripts/review-demo.js") as {
  createReviewKeyHandler: (actions: {
    enableHotReload: () => void;
    openFirefox: () => void;
    reload: () => void;
    setTerminalFocused: (focused: boolean) => void;
    stop: () => void;
  }) => (input: string) => void;
};

describe("review demo server", () => {
  test("reloads on r or R and ignores unrelated input", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
    });

    handleKey("rxR");

    expect(reload).toHaveBeenCalledTimes(2);
    expect(enableHotReload).not.toHaveBeenCalled();
    expect(openFirefox).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  test("enables hot reload on h or H", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
    });

    handleKey("hH");

    expect(enableHotReload).toHaveBeenCalledTimes(2);
    expect(openFirefox).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  test("opens Firefox on f or F", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
    });

    handleKey("fF");

    expect(openFirefox).toHaveBeenCalledTimes(2);
    expect(enableHotReload).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  test("tracks terminal focus and treats keyboard input as active", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
    });

    handleKey("\u001B[O");
    handleKey("\u001B[I");
    handleKey("x");

    expect(setTerminalFocused.mock.calls).toEqual([[false], [true], [true]]);
    expect(enableHotReload).not.toHaveBeenCalled();
    expect(openFirefox).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  test("stops on Ctrl+C without processing later input", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const setTerminalFocused = vi.fn();
    const stop = vi.fn();
    const handleKey = createReviewKeyHandler({
      enableHotReload,
      openFirefox,
      reload,
      setTerminalFocused,
      stop,
    });

    handleKey(`r\u0003f`);

    expect(reload).toHaveBeenCalledOnce();
    expect(openFirefox).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });
});
