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
  await Promise.resolve();
};

const flushLiveScan = async () => {
  await settle();
  await vi.advanceTimersByTimeAsync(200);
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
    vi.useFakeTimers();
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
    await flushLiveScan();

    expect(send).toHaveBeenCalledTimes(1);
    releases.shift()?.();
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await controller.idle();

    document.body.append(document.querySelector("img")!);
    await flushLiveScan();
    expect(send).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  test("does not observe later insertions when live discovery is off", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });
    await controller.idle();
    document.body.innerHTML = '<img src="https://cdn.test/later.png">';
    await vi.advanceTimersByTimeAsync(250);
    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });

  test("enforces the page limit before sending and ignores non-network sources", async () => {
    document.body.innerHTML = `
      <img src="https://cdn.test/one.png">
      <img src="https://cdn.test/two.png">
      <img src="https://cdn.test/three.png">
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

  test.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "uses the validated default when the page limit is %s",
    async (maxPerPage) => {
      document.body.innerHTML = Array.from(
        { length: 21 },
        (_, index) => `<img src="https://cdn.test/${index}.png">`,
      ).join("");
      const send = vi.fn(() => Promise.resolve("started" as const));
      const limitReached = vi.fn();
      const controller = setupAutoDownloadDiscovery({
        rules,
        live: false,
        maxPerPage,
        send,
        onLimitReached: limitReached,
      });

      await controller.idle();

      expect(send).toHaveBeenCalledTimes(20);
      expect(limitReached).toHaveBeenCalledOnce();
      controller.stop();
    },
  );

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

  test("contains a rejected send and ignores scans while the queue is already draining", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/one.png">';
    let rejectSend!: (error: Error) => void;
    const send = vi.fn(
      () =>
        new Promise<"started">((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    controller.scan();
    rejectSend(new Error("extension context invalidated"));
    await controller.idle();

    expect(send).toHaveBeenCalledOnce();
    controller.stop();
  });

  test("is inert without eligible rules and after it has stopped", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/one.png">';
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: "filename: \\.png$\ninto: files/",
      live: true,
      maxPerPage: 20,
      send,
    });
    await controller.idle();
    controller.scan();
    controller.stop();
    controller.stop();
    controller.scan();

    expect(send).not.toHaveBeenCalled();
  });

  test("ignores mutations that add no discoverable elements", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 20, send });
    document.body.append(document.createTextNode("text only"));
    await flushLiveScan();

    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });
});
