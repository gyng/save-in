import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cleanupReviewSession, createDemoServer, createReviewKeyHandler } =
  require("../scripts/review-demo.js") as {
    cleanupReviewSession: (
      session: {
        browser?: { proc: object; profileDir: string };
        server: import("node:http").Server;
      },
      cleanup: {
        killTree: (proc: object) => Promise<void>;
        removeProfile: (profileDir: string) => Promise<void>;
      },
    ) => Promise<void>;
    createDemoServer: () => import("node:http").Server;
    createReviewKeyHandler: (actions: {
      enableHotReload: () => void;
      openFirefox: () => void;
      reload: () => void;
      stop: () => void;
    }) => (input: string) => void;
  };

describe("review demo server", () => {
  test("closes the server and removes the throwaway browser profile", async () => {
    const server = createDemoServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const proc = {};
    const killTree = vi.fn(async () => undefined);
    const removeProfile = vi.fn(async () => undefined);

    await cleanupReviewSession(
      { browser: { proc, profileDir: "review-profile-unique" }, server },
      { killTree, removeProfile },
    );

    expect(killTree).toHaveBeenCalledWith(proc);
    expect(removeProfile).toHaveBeenCalledWith("review-profile-unique");
    expect(server.listening).toBe(false);
  });

  test("reloads on r or R and ignores unrelated input", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const stop = vi.fn();
    const handleKey = createReviewKeyHandler({ enableHotReload, openFirefox, reload, stop });

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
    const stop = vi.fn();
    const handleKey = createReviewKeyHandler({ enableHotReload, openFirefox, reload, stop });

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
    const stop = vi.fn();
    const handleKey = createReviewKeyHandler({ enableHotReload, openFirefox, reload, stop });

    handleKey("fF");

    expect(openFirefox).toHaveBeenCalledTimes(2);
    expect(enableHotReload).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  test("stops on Ctrl+C without processing later input", () => {
    const enableHotReload = vi.fn();
    const openFirefox = vi.fn();
    const reload = vi.fn();
    const stop = vi.fn();
    const handleKey = createReviewKeyHandler({ enableHotReload, openFirefox, reload, stop });

    handleKey(`r\u0003f`);

    expect(reload).toHaveBeenCalledOnce();
    expect(openFirefox).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });

  test("serves the late-discovered image as an actual WebP", async () => {
    const server = createDemoServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      expect(address).not.toBeNull();
      expect(typeof address).not.toBe("string");
      if (!address || typeof address === "string") return;

      const response = await fetch(`http://127.0.0.1:${address.port}/late-image.webp`);
      const bytes = new Uint8Array(await response.arrayBuffer());

      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
      expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WEBP");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test("serves the in-repo store demo photo as AVIF", async () => {
    const server = createDemoServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      expect(address).not.toBeNull();
      expect(typeof address).not.toBe("string");
      if (!address || typeof address === "string") return;

      const response = await fetch(`http://127.0.0.1:${address.port}/demo-photo.avif`);
      const bytes = new Uint8Array(await response.arrayBuffer());

      expect(response.headers.get("content-type")).toBe("image/avif");
      expect(new TextDecoder().decode(bytes.slice(4, 12))).toBe("ftypavif");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test("serves a realistic listing screenshot page separately from the review checklist", async () => {
    const server = createDemoServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      expect(address).not.toBeNull();
      expect(typeof address).not.toBe("string");
      if (!address || typeof address === "string") return;

      const response = await fetch(`http://127.0.0.1:${address.port}/store-demo`);
      const html = await response.text();

      expect(html).toContain("A quiet afternoon with Miso");
      expect(html).toContain("/demo-photo.avif");
      expect(html).not.toContain("save-in review demo");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
