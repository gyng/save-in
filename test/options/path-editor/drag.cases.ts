// Drag cases use their own jsdom boundary so the expensive visual-editor
// interactions can run in parallel with the rest of the path editor suite.
import { PathEditor } from "../../../src/options/path-editor.ts";

const element = <T extends Element>(selector: string): T => {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing test element: ${selector}`);
  return match;
};

describe("visual editor drag and drop", () => {
  const dragEvent = (type: string, clientX: number, clientY = 0) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clientX", { value: clientX });
    Object.defineProperty(event, "clientY", { value: clientY });
    return event;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(browser.i18n.getMessage).mockImplementation((key) =>
      key === "pathVisualMoveHere" ? "Move here" : "",
    );
    document.body.innerHTML = `
      <textarea id="paths">a\nb\nc</textarea>
      <div id="path-editor-rows"></div>
    `;
    global.browser.runtime.sendMessage = vi.fn(() => Promise.resolve({}));
    new PathEditor().setupVisualEditor();
    document.dispatchEvent(new Event("options-restored"));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  test("dropping a dragged row onto another nests it", () => {
    const rows = document.querySelectorAll(".path-editor-row");
    rows[0]!.querySelector(".path-editor-handle")!.dispatchEvent(new Event("dragstart"));
    rows[2]!.dispatchEvent(new Event("drop"));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("b\nc\n>a");
  });

  test("a drop without a drag is ignored", () => {
    const rows = document.querySelectorAll(".path-editor-row");
    rows[0]!.dispatchEvent(new Event("drop"));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("a\nb\nc");
  });

  test("one shared boundary between rows moves the row there", () => {
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    const zones = document.querySelectorAll<HTMLElement>(".path-editor-drop-zone");
    expect(zones).toHaveLength(rows.length + 1);

    rows[2]!.querySelector(".path-editor-handle")!.dispatchEvent(dragEvent("dragstart", 0));
    zones[1]!.dispatchEvent(dragEvent("dragover", 0));
    expect(zones[1]!.querySelector(".path-editor-drop-indicator")?.textContent).toContain(
      "Move here",
    );
    zones[1]!.dispatchEvent(dragEvent("drop", 0));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("a\nc\nb");
  });

  test("the final boundary moves a row after the list", () => {
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    const zones = document.querySelectorAll<HTMLElement>(".path-editor-drop-zone");
    rows[0]!.querySelector(".path-editor-handle")!.dispatchEvent(dragEvent("dragstart", 0));
    zones[zones.length - 1]!.dispatchEvent(dragEvent("drop", 0));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("b\nc\na");
  });

  test("the row target moves a row inside the highlighted group", () => {
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    rows[2]!.querySelector(".path-editor-handle")!.dispatchEvent(dragEvent("dragstart", 100));
    rows[0]!.dispatchEvent(dragEvent("dragover", 100));

    rows[0]!.dispatchEvent(dragEvent("drop", 100));
    expect(element<HTMLTextAreaElement>("#paths").value).toBe("a\n>c\nb");
  });

  test("drag lifecycle supports Firefox data transfer and clears indicators", () => {
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    const handle = rows[0]!.querySelector<HTMLElement>(".path-editor-handle")!;
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    const start = dragEvent("dragstart", 0);
    Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
    handle.dispatchEvent(start);
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "0");
    expect(dataTransfer.effectAllowed).toBe("move");

    rows[1]!.dispatchEvent(dragEvent("dragover", 0, 0));
    const indicator = rows[1]!.querySelector(".path-editor-drop-indicator");
    expect(indicator).not.toBeNull();
    rows[1]!.dispatchEvent(dragEvent("dragover", 0, 0));
    expect(rows[1]!.querySelector(".path-editor-drop-indicator")).toBe(indicator);
    handle.dispatchEvent(new Event("dragend"));
    expect(rows[1]!.querySelector(".path-editor-drop-indicator")).toBeNull();

    handle.dispatchEvent(start);
    rows[1]!.dispatchEvent(dragEvent("dragover", 0, 0));
    rows[1]!.dispatchEvent(dragEvent("dragleave", 0));
    expect(rows[1]!.querySelector(".path-editor-drop-indicator")).toBeNull();

    handle.dispatchEvent(start);
    rows[1]!.dispatchEvent(dragEvent("dragover", 0, 0));
    const nestedIndicator = rows[1]!.querySelector(".path-editor-drop-indicator")!;
    const nestedLeave = dragEvent("dragleave", 0);
    Object.defineProperty(nestedLeave, "relatedTarget", { value: nestedIndicator });
    rows[1]!.dispatchEvent(nestedLeave);
    expect(rows[1]!.querySelector(".path-editor-drop-indicator")).toBe(nestedIndicator);
  });

  test("dragover without an active drag leaves the row unchanged", () => {
    const row = document.querySelectorAll<HTMLElement>(".path-editor-row")[0]!;
    const event = dragEvent("dragover", 0, 0);
    row.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(row.querySelector(".path-editor-drop-indicator")).toBeNull();
  });

  test("boundary zones contain inactive, repeated, nested-leave, and stale drops", () => {
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    const zones = document.querySelectorAll<HTMLElement>(".path-editor-drop-zone");
    const zone = zones[1]!;
    const inactiveOver = dragEvent("dragover", 0);
    zone.dispatchEvent(inactiveOver);
    expect(inactiveOver.defaultPrevented).toBe(false);
    const inactiveDrop = dragEvent("drop", 0);
    zone.dispatchEvent(inactiveDrop);

    rows[2]!.querySelector(".path-editor-handle")!.dispatchEvent(dragEvent("dragstart", 0));
    zone.dispatchEvent(dragEvent("dragover", 0));
    const indicator = zone.querySelector(".path-editor-drop-indicator")!;
    zone.dispatchEvent(dragEvent("dragover", 0));
    expect(zone.querySelector(".path-editor-drop-indicator")).toBe(indicator);
    const nestedLeave = dragEvent("dragleave", 0);
    Object.defineProperty(nestedLeave, "relatedTarget", { value: indicator });
    zone.dispatchEvent(nestedLeave);
    expect(zone.querySelector(".path-editor-drop-indicator")).toBe(indicator);
    zone.dispatchEvent(dragEvent("dragleave", 0));
    expect(zone.querySelector(".path-editor-drop-indicator")).toBeNull();

    const staleFinalZone = zones[zones.length - 1]!;
    const staleHandle = rows[0]!.querySelector(".path-editor-handle")!;
    staleHandle.dispatchEvent(dragEvent("dragstart", 0));
    element<HTMLTextAreaElement>("#paths").value = "";
    document.dispatchEvent(new Event("options-restored"));
    staleFinalZone.dispatchEvent(dragEvent("drop", 0));
    expect(element<HTMLTextAreaElement>("#paths").value).toBe("");
  });
});
