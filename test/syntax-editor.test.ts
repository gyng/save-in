// @vitest-environment jsdom
import { createSyntaxEditor, setSyntaxEditorDiagnostics } from "../src/options/syntax-editor.ts";

describe("syntax editor surface", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("mirrors edits in the highlighted source overlay", () => {
    document.body.innerHTML = '<label>Rules<textarea id="rules"></textarea></label>';
    const label = document.querySelector("label")!;
    const textarea = document.querySelector("textarea")!;
    textarea.value = "filename/i: \\.png$\ninto: images/:date:";
    const editor = createSyntaxEditor(textarea, "routing");

    expect(textarea.getAttribute("wrap")).toBe("off");
    const overlay = label.querySelector<HTMLElement>('pre[aria-hidden="true"]')!;
    expect(overlay.textContent).toContain(textarea.value);

    textarea.value += "\nbroken";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const diagnostic = overlay.querySelector<HTMLElement>("[data-diagnostic]")!;
    expect(diagnostic.textContent).toBe("broken");
    expect(diagnostic.dataset.diagnostic).toContain("L3:");

    setSyntaxEditorDiagnostics(textarea, [
      {
        start: textarea.value.length - "broken".length,
        end: textarea.value.length,
        line: 3,
        column: 0,
        message: "Invalid clause: broken",
        severity: "error",
      },
    ]);
    expect(document.querySelector('[data-diagnostic="L3: Invalid clause: broken"]')).not.toBeNull();
    expect(document.querySelectorAll(".syntax-editor-inline-diagnostic")).toHaveLength(1);
    expect(document.querySelector(".syntax-editor-inline-diagnostic")?.textContent).toBe(
      "L3: Invalid clause: broken",
    );

    editor.destroy();
    expect(label.querySelector("pre")).toBeNull();
    expect(textarea.parentElement).toBe(label);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  test("renders diagnostics, tooltip state, and gutter navigation", () => {
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

    const overlay = document.querySelector<HTMLElement>('pre[aria-hidden="true"]')!;
    const diagnostic = overlay.querySelector<HTMLElement>(
      '[data-diagnostic="L2: Bad destination"]',
    )!;
    expect(diagnostic.textContent).toBe("second");
    expect(diagnostic.dataset.diagnostic).toBe("L2: Bad destination");
    expect(
      document.querySelector<HTMLElement>('[data-start="6"][data-diagnostic="L2: Bad destination"]')
        ?.textContent,
    ).toBe("2");
    expect(document.querySelector(".syntax-editor-inline-diagnostic")?.textContent).toBe(
      "L2: Bad destination",
    );

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
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain("L2");
    expect(tooltip.textContent).toContain("Bad destination");
    expect(Number.parseFloat(tooltip.style.top)).toBeLessThan(25);
    textarea.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tooltip.hidden).toBe(true);

    textarea.setSelectionRange(8, 8);
    textarea.dispatchEvent(new MouseEvent("click"));
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain("Bad destination");
    textarea.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tooltip.hidden).toBe(false);
    textarea.dispatchEvent(new FocusEvent("blur"));
    expect(tooltip.hidden).toBe(true);

    textarea.value = "first\nfixed";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(overlay.querySelector('[data-diagnostic="L2: Bad destination"]')).toBeNull();
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
    expect(overlay.querySelector('[data-diagnostic="L2: Value required"]')?.textContent).toBe("d");

    Object.defineProperties(textarea, {
      scrollLeft: { value: 14, configurable: true },
      scrollTop: { value: 22, configurable: true },
    });
    textarea.dispatchEvent(new Event("scroll"));
    expect(
      document.querySelector<HTMLElement>(".syntax-editor-inline-diagnostics")!.style.transform,
    ).toBe("translate(-14px, -22px)");

    document
      .querySelector<HTMLElement>('div[aria-hidden="true"] [data-start="6"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(textarea.selectionStart).toBe(6);
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain("L2");
  });
});
