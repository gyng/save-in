// @vitest-environment jsdom
import { createDestinationPickerClient } from "../../src/content/destination-picker-client.ts";
import { closeDestinationPicker } from "../../src/content/destination-picker.ts";

const model = {
  lastUsed: null,
  items: [
    { kind: "path", id: "save-in-0", title: "Images", parentId: null },
    { kind: "path", id: "save-in-1", title: "Work", parentId: null },
  ],
  copy: { title: "Choose a folder", filter: "Filter", empty: "None", lastUsed: "Last used" },
};

type Message = { type: string; body?: unknown };
type Respond = (response?: unknown) => void;

let disabled = false;
let invalidated = false;
const releaseIfInvalidated = vi.fn(() => invalidated);
const sendMessage = vi.fn<(message: Message, respond: Respond) => void>();
const sent = (): Message[] => sendMessage.mock.calls.map(([message]) => message);

const answerWith =
  (answers: Record<string, unknown>) =>
  (message: Message, respond: Respond): void =>
    respond(answers[message.type]);

const client = () =>
  createDestinationPickerClient({
    isPageDisabled: () => disabled,
    theme: () => "dark",
    releaseIfInvalidated,
  });

const host = (): HTMLElement | null => document.querySelector<HTMLElement>("save-in-picker");
const pressEnter = (): void => {
  host()
    ?.shadowRoot?.querySelector("input")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
};

beforeEach(() => {
  disabled = false;
  invalidated = false;
  releaseIfInvalidated.mockReset();
  releaseIfInvalidated.mockImplementation(() => invalidated);
  sendMessage.mockReset();
  sendMessage.mockImplementation(
    answerWith({
      PICKER_MODEL: { type: "PICKER_MODEL", body: model },
      PICKER_SAVE: { type: "OK" },
    }),
  );
  global.chrome.runtime.sendMessage = sendMessage as never;
  Reflect.deleteProperty(global.chrome.runtime, "lastError");
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  closeDestinationPicker();
});

describe("destination picker client", () => {
  test("shows the background's model and saves the chosen id with its source", async () => {
    const source = { media: { url: "https://x.test/a.png", kind: "image" as const } };

    expect(await client().open(source, { x: 10, y: 20 })).toBe(true);
    expect(host()?.dataset.theme).toBe("dark");
    expect(host()?.style.getPropertyValue("--picker-x")).toBe("10px");

    pressEnter();
    expect(sent()).toEqual([
      { type: "PICKER_MODEL" },
      { type: "PICKER_SAVE", body: { menuItemId: "save-in-0", source } },
    ]);
    expect(host()).toBeNull();
  });

  test("a page save carries no source", async () => {
    await client().open(null);
    pressEnter();

    expect(sent()[1]).toEqual({
      type: "PICKER_SAVE",
      body: { menuItemId: "save-in-0", source: null },
    });
  });

  test("opens nothing on a disabled site or after the extension was reloaded", async () => {
    disabled = true;
    expect(await client().open(null)).toBe(false);
    disabled = false;
    invalidated = true;
    expect(await client().open(null)).toBe(false);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(host()).toBeNull();
  });

  test("opens nothing when the page lands on the disable list while the model loads", async () => {
    sendMessage.mockImplementation((message, respond) => {
      disabled = true;
      answerWith({ PICKER_MODEL: { type: "PICKER_MODEL", body: model } })(message, respond);
    });

    expect(await client().open(null)).toBe(false);
    expect(host()).toBeNull();
  });

  test.each([
    ["an older background answers nothing", undefined],
    ["the answer is another message", { type: "OK", body: model }],
    ["the model is malformed", { type: "PICKER_MODEL", body: { items: "none" } }],
    ["no destination is offered", { type: "PICKER_MODEL", body: { ...model, items: [] } }],
  ])("opens nothing when %s", async (_label, answer) => {
    sendMessage.mockImplementation(answerWith({ PICKER_MODEL: answer }));

    expect(await client().open(null)).toBe(false);
    expect(host()).toBeNull();
  });

  test("only the latest of two overlapping requests opens", async () => {
    const pending: Respond[] = [];
    sendMessage.mockImplementation((_message, respond) => pending.push(respond));
    const picker = client();

    const first = picker.open({ linkUrl: "https://x.test/first" });
    const second = picker.open({ linkUrl: "https://x.test/second" });
    pending.forEach((respond) => respond({ type: "PICKER_MODEL", body: model }));

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    sendMessage.mockImplementation(answerWith({}));
    pressEnter();
    expect(sent().at(-1)).toEqual({
      type: "PICKER_SAVE",
      body: { menuItemId: "save-in-0", source: { linkUrl: "https://x.test/second" } },
    });
  });

  test("retries a request that raced the background's cold start", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    sendMessage.mockImplementation((message, respond) => {
      attempts += 1;
      if (attempts === 1) {
        (global.chrome.runtime as { lastError?: unknown }).lastError = { message: "no receiver" };
        respond();
        Reflect.deleteProperty(global.chrome.runtime, "lastError");
        return;
      }
      answerWith({ PICKER_MODEL: { type: "PICKER_MODEL", body: model } })(message, respond);
    });

    const opened = client().open(null);
    await vi.advanceTimersByTimeAsync(300);

    expect(await opened).toBe(true);
    expect(attempts).toBe(2);
  });

  test("gives up after the retries, and at once when the context is gone", async () => {
    vi.useFakeTimers();
    sendMessage.mockImplementation((_message, respond) => {
      (global.chrome.runtime as { lastError?: unknown }).lastError = { message: "no receiver" };
      respond();
      Reflect.deleteProperty(global.chrome.runtime, "lastError");
    });

    const opened = client().open(null);
    await vi.advanceTimersByTimeAsync(600);
    expect(await opened).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(3);

    sendMessage.mockClear();
    releaseIfInvalidated.mockReturnValueOnce(false).mockReturnValue(true);
    expect(await client().open(null)).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test("reports an invalidated context when the message cannot be sent at all", async () => {
    sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated");
    });

    expect(await client().open(null)).toBe(false);
    expect(releaseIfInvalidated).toHaveBeenCalledTimes(2);
  });

  test("a click-to-save gesture opens for the element it resolved", async () => {
    const picker = client();
    const point = { x: 5, y: 6 };

    expect(await picker.openForClick({ url: "https://x.test/full", kind: "link" }, point)).toBe(
      true,
    );
    pressEnter();
    expect(await picker.openForClick({ url: "https://x.test/v.mp4", kind: "video" }, point)).toBe(
      true,
    );
    pressEnter();

    expect(sent().filter(({ type }) => type === "PICKER_SAVE")).toEqual([
      {
        type: "PICKER_SAVE",
        body: { menuItemId: "save-in-0", source: { linkUrl: "https://x.test/full" } },
      },
      {
        type: "PICKER_SAVE",
        body: {
          menuItemId: "save-in-0",
          source: { media: { url: "https://x.test/v.mp4", kind: "video" } },
        },
      },
    ]);
  });

  test("a clicked image keeps its alt text for the save", async () => {
    const picker = client();
    await picker.openForClick(
      { url: "https://x.test/a.png", kind: "image", alt: "Misty forest" },
      { x: 5, y: 6 },
    );
    pressEnter();

    expect(sent().filter(({ type }) => type === "PICKER_SAVE")).toEqual([
      {
        type: "PICKER_SAVE",
        body: {
          menuItemId: "save-in-0",
          source: { media: { url: "https://x.test/a.png", kind: "image", alt: "Misty forest" } },
        },
      },
    ]);
  });

  test("a gesture on something that cannot be saved as itself opens nothing", async () => {
    expect(
      await client().openForClick(
        { url: "https://x.test/doc.pdf", kind: "document" },
        { x: 1, y: 1 },
      ),
    ).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("close removes an open picker", async () => {
    const picker = client();
    await picker.open(null);
    picker.close();

    expect(host()).toBeNull();
  });
});
