// @vitest-environment jsdom
import { createSyntaxEditor, setSyntaxEditorDiagnostics } from "../src/options/syntax-editor.ts";

describe("syntax editor surface", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("adds a synchronized gutter and highlighted source overlay", () => {
    document.body.innerHTML = '<label>Rules<textarea id="rules"></textarea></label>';
    const textarea = document.querySelector("textarea")!;
    textarea.value = "filename/i: \\.png$\ninto: images/:date:";
    const editor = createSyntaxEditor(textarea, "routing");

    expect(textarea.parentElement?.className).toBe("syntax-editor-stage");
    expect(textarea.closest(".syntax-editor")?.getAttribute("data-language")).toBe("routing");
    expect(textarea.getAttribute("wrap")).toBe("off");
    expect(document.querySelectorAll(".syntax-editor-line-number")).toHaveLength(2);
    expect(document.querySelector(".syntax-token-matcher")?.textContent).toBe("filename");
    expect(document.querySelector(".syntax-token-variable")?.textContent).toBe(":date:");

    textarea.value += "\nbroken";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(document.querySelectorAll(".syntax-editor-line-number")).toHaveLength(3);
    expect(document.querySelector(".syntax-token-invalid")?.textContent).toBe("broken");
    expect(document.querySelector(".syntax-diagnostic-error")?.textContent).toBe("broken");

    editor.destroy();
    expect(document.querySelector(".syntax-editor")).toBeNull();
    expect(document.body.querySelector("textarea")).toBe(textarea);
  });

  test("renders ranged diagnostics, gutter markers, hover text, and scroll synchronization", () => {
    document.body.innerHTML = '<textarea id="paths">first\nsecond</textarea>';
    const textarea = document.querySelector("textarea")!;
    createSyntaxEditor(textarea, "directories");
    setSyntaxEditorDiagnostics(textarea, [
      {
        start: 6,
        end: 12,
        line: 2,
        column: 0,
        message: "Bad destination",
        severity: "warning",
      },
    ]);

    const diagnostic = document.querySelector<HTMLElement>(".syntax-diagnostic-warning")!;
    expect(diagnostic.textContent).toBe("second");
    expect(diagnostic.title).toBe("Bad destination");
    expect(document.querySelectorAll(".has-diagnostic-warning")).toHaveLength(1);

    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    textarea.dispatchEvent(new MouseEvent("mousemove", { clientX: 2, clientY: 25 }));
    const tooltip = document.querySelector<HTMLElement>(".syntax-editor-tooltip")!;
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe("Bad destination");
    textarea.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tooltip.hidden).toBe(true);

    textarea.value = "first\nfixed";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(document.querySelector(".syntax-diagnostic-warning")).toBeNull();
    setSyntaxEditorDiagnostics(textarea, [
      {
        start: textarea.value.length,
        end: textarea.value.length,
        line: 2,
        column: 5,
        message: "Value required",
        severity: "error",
      },
    ]);
    expect(document.querySelector(".syntax-diagnostic-error")?.textContent).toBe("d");

    Object.defineProperties(textarea, {
      scrollLeft: { value: 14, configurable: true },
      scrollTop: { value: 22, configurable: true },
    });
    textarea.dispatchEvent(new Event("scroll"));
    expect(document.querySelector<HTMLElement>(".syntax-editor-overlay")!.style.transform).toBe(
      "translate(-14px, -22px)",
    );
    expect(document.querySelector<HTMLElement>(".syntax-editor-gutter")!.style.transform).toBe(
      "translateY(-22px)",
    );

    document
      .querySelectorAll<HTMLElement>(".syntax-editor-line-number")[1]!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(textarea.selectionStart).toBe(6);
  });
});
