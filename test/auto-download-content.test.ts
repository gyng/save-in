// @vitest-environment jsdom
import { setupAutoDownloadDiscovery } from "../src/content/auto-download.ts";

const rules = `
context: ^auto$
pageurl: ^http://localhost/
sourcekind: image
sourceurl/i: \\.(?:png|jpg)(?:[?#].*)?$
into: automatic/
`;

const settle = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("automatic source discovery", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  test("queues matching selected page sources after initial discovery", async () => {
    document.body.innerHTML = `
      <img src="https://cdn.test/cat.png">
      <img src="https://cdn.test/readme.txt">
      <a href="https://cdn.test/linked.jpg">linked image</a>
    `;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });

    await controller.idle();

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      pageUrl: "http://localhost/",
      sourceUrl: "https://cdn.test/cat.png",
      sourceKind: "image",
    });
    controller.stop();
  });

  test("keeps valid automation active when an unrelated routing rule is invalid", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/cat.png">';
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: `filename: \\.pdf$\n\n${rules}`,
      live: false,
      maxPerPage: 20,
      send,
    });

    await controller.idle();

    expect(send).toHaveBeenCalledOnce();
    controller.stop();
  });

  test("discovers live insertions once and processes them sequentially", async () => {
    const releases: Array<() => void> = [];
    const send = vi.fn(
      () =>
        new Promise<"started">((resolve) => {
          releases.push(() => resolve("started"));
        }),
    );
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 20, send });
    await settle();

    document.body.insertAdjacentHTML(
      "beforeend",
      '<img src="https://cdn.test/one.png"><img src="https://cdn.test/two.jpg">',
    );
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(send).toHaveBeenCalledTimes(1);
    releases.shift()?.();
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await controller.idle();

    document.body.append(document.querySelector("img")!);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(send).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  test("does not observe later insertions when live discovery is off", async () => {
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });
    await controller.idle();
    document.body.innerHTML = '<img src="https://cdn.test/later.png">';
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });

  test("enforces the page limit before sending and ignores non-network sources", async () => {
    document.body.innerHTML = `
      <img src="https://cdn.test/one.png">
      <img src="https://cdn.test/two.png">
      <img src="data:image/png;base64,AAAA">
    `;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const limitReached = vi.fn();
    const controller = setupAutoDownloadDiscovery({
      rules,
      live: false,
      maxPerPage: 1,
      send,
      onLimitReached: limitReached,
    });
    await controller.idle();

    expect(send).toHaveBeenCalledOnce();
    expect(limitReached).toHaveBeenCalledOnce();
    controller.stop();
  });

  test("stopping cancels observation and prevents queued sends", async () => {
    document.body.innerHTML = `
      <img src="https://cdn.test/one.png">
      <img src="https://cdn.test/two.png">
    `;
    let release: (() => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<"started">((resolve) => {
          release = () => resolve("started");
        }),
    );
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 20, send });
    await settle();
    expect(send).toHaveBeenCalledOnce();
    controller.stop();
    release?.();
    await settle();
    expect(send).toHaveBeenCalledOnce();
  });
});
