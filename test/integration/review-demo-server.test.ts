import { createRequire } from "node:module";
import { closeServer, listenOnLoopback } from "./server.ts";

const require = createRequire(import.meta.url);
const { cleanupReviewSession, createDemoServer } = require("../../scripts/review-demo.js") as {
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
};

describe("review demo server over HTTP", () => {
  test("closes the server and removes the throwaway browser profile", async () => {
    const server = createDemoServer();
    await listenOnLoopback(server);
    const proc = {};
    const killTree = vi.fn(async () => undefined);
    const removeProfile = vi.fn(async () => undefined);

    try {
      await cleanupReviewSession(
        { browser: { proc, profileDir: "review-profile-unique" }, server },
        { killTree, removeProfile },
      );

      expect(killTree).toHaveBeenCalledWith(proc);
      expect(removeProfile).toHaveBeenCalledWith("review-profile-unique");
      expect(server.listening).toBe(false);
    } finally {
      await closeServer(server);
    }
  });

  test("continues cleanup and aggregates a browser termination failure", async () => {
    const server = createDemoServer();
    await listenOnLoopback(server);
    const proc = {};
    const terminationFailure = new Error("could not stop browser");
    const killTree = vi.fn(async () => {
      throw terminationFailure;
    });
    const removeProfile = vi.fn(async () => undefined);

    try {
      await expect(
        cleanupReviewSession(
          { browser: { proc, profileDir: "review-profile-failed-cleanup" }, server },
          { killTree, removeProfile },
        ),
      ).rejects.toMatchObject({ errors: [terminationFailure] });

      expect(removeProfile).toHaveBeenCalledWith("review-profile-failed-cleanup");
      expect(server.listening).toBe(false);
    } finally {
      await closeServer(server);
    }
  });

  test("serves the late-discovered image as an actual WebP", async () => {
    const server = createDemoServer();
    const { port } = await listenOnLoopback(server);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/late-image.webp`);
      const bytes = new Uint8Array(await response.arrayBuffer());

      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
      expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WEBP");
    } finally {
      await closeServer(server);
    }
  });

  test("serves the in-repo store demo photo as AVIF", async () => {
    const server = createDemoServer();
    const { port } = await listenOnLoopback(server);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/demo-photo.avif`);
      const bytes = new Uint8Array(await response.arrayBuffer());

      expect(response.headers.get("content-type")).toBe("image/avif");
      expect(new TextDecoder().decode(bytes.slice(4, 12))).toBe("ftypavif");
    } finally {
      await closeServer(server);
    }
  });

  test("serves a realistic listing screenshot page separately from the review checklist", async () => {
    const server = createDemoServer();
    const { port } = await listenOnLoopback(server);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/store-demo`);
      const html = await response.text();

      expect(html).toContain("A quiet afternoon with Miso");
      expect(html).toContain("/demo-photo.avif");
      expect(html).not.toContain("save-in review demo");
    } finally {
      await closeServer(server);
    }
  });
});
