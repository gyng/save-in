import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createDemoServer } = require("../scripts/review-demo.js") as {
  createDemoServer: () => import("node:http").Server;
};

describe("review demo server", () => {
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
