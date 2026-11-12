// @vitest-environment jsdom
import { setupPickerGesture } from "../../../src/options/core/picker-gesture.ts";
import {
  CLICK_GESTURES,
  DEFAULT_PICKER_BINDINGS,
  parseClickToSaveBindings,
  serializeClickToSaveBindings,
  type ClickToSaveBinding,
} from "../../../src/shared/click-gesture.ts";

const change = (element: Element) => element.dispatchEvent(new Event("change", { bubbles: true }));
const element = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const select = (id: string) => element<HTMLSelectElement>(id);
const field = () => element<HTMLInputElement>("contentPickerBindings");
const status = () => element<HTMLElement>("pickerGestureStatus");
const choose = (id: string, value: string) => {
  select(id).value = value;
  change(select(id));
};
const toggle = (id: string, checked: boolean) => {
  element<HTMLInputElement>(id).checked = checked;
  change(element(id));
};
const stored = (...bindings: ClickToSaveBinding[]) => serializeClickToSaveBindings(bindings);

const MODIFIERS = `<option value=""></option><option value="Alt">Alt</option>
  <option value="Ctrl">Ctrl</option><option value="Shift">Shift</option>`;

const mount = ({
  picker = DEFAULT_PICKER_BINDINGS,
  pickerOn = true,
  saves = "",
  savesOn = true,
} = {}) => {
  document.body.innerHTML = `
    <input type="checkbox" id="contentClickToSave" ${savesOn ? "checked" : ""}>
    <input type="hidden" id="contentClickToSaveBindings" value='${saves}'>
    <input type="hidden" id="contentClickToSaveCombo" value="Alt">
    <input type="hidden" id="contentClickToSaveButton" value="LEFT_CLICK">
    <input type="checkbox" id="contentPickerGesture" ${pickerOn ? "checked" : ""}>
    <fieldset id="pickerGestureControls">
      <input type="hidden" id="contentPickerBindings" value='${picker}'>
      <select id="pickerGestureModifier">${MODIFIERS}<option value="Bogus">Bogus</option></select>
      <select id="pickerGestureModifier2">${MODIFIERS}</select>
      <select id="pickerGestureButton">
        <option value="left-click">Left</option><option value="middle-click">Middle</option>
        <option value="double-left-click">Double</option><option value="long-left-click">Long</option>
      </select>
      <div id="pickerGestureStatus" role="status" hidden>Already used</div>
      <div id="picker-gesture-warning" role="status" hidden>Plain left click</div>
      <div id="picker-gesture-double-warning" role="status" hidden>Double</div>
      <div id="picker-gesture-long-warning" role="status" hidden>Long</div>
    </fieldset>`;
  setupPickerGesture();
};

describe("folder picker gesture controller", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("tolerates an options document without the picker controls", () => {
    expect(() => setupPickerGesture()).not.toThrow();
    document.dispatchEvent(new Event("options-restored"));
  });

  test("shows the stored gesture, and the default for an unreadable one", () => {
    mount({ picker: stored({ gesture: CLICK_GESTURES.MIDDLE, combo: "Ctrl" }) });
    expect(
      ["pickerGestureModifier", "pickerGestureModifier2", "pickerGestureButton"].map(
        (id) => select(id).value,
      ),
    ).toEqual(["Ctrl", "", "middle-click"]);

    mount({ picker: "{" });
    expect(
      ["pickerGestureModifier", "pickerGestureModifier2", "pickerGestureButton"].map(
        (id) => select(id).value,
      ),
    ).toEqual(["Alt", "Shift", "left-click"]);
    // Showing a value is not a change: nothing is written until the user acts.
    expect(field().value).toBe("{");
  });

  test("shows a key-code combo from an imported profile as a legacy value", () => {
    mount({ picker: stored({ gesture: CLICK_GESTURES.LEFT, combo: "90" }) });

    expect(select("pickerGestureModifier").value).toBe("90");
    expect(select("pickerGestureModifier").selectedOptions[0]?.dataset.legacy).toBe("true");
  });

  test("writes the gesture as soon as a control changes", () => {
    mount();
    const saved = vi.fn();
    field().addEventListener("change", saved);

    choose("pickerGestureButton", "middle-click");
    expect(parseClickToSaveBindings(field().value)).toEqual([
      { gesture: CLICK_GESTURES.MIDDLE, combo: "Alt+Shift" },
    ]);
    choose("pickerGestureModifier2", "");
    choose("pickerGestureModifier", "");
    expect(parseClickToSaveBindings(field().value)).toEqual([
      { gesture: CLICK_GESTURES.MIDDLE, combo: "" },
    ]);
    expect(saved).toHaveBeenCalledTimes(3);

    // The same modifier twice is one key, and re-choosing a value is no write.
    choose("pickerGestureModifier", "Ctrl");
    choose("pickerGestureModifier2", "Ctrl");
    expect(select("pickerGestureModifier2").value).toBe("");
    expect(saved).toHaveBeenCalledTimes(4);
  });

  test("keeps the stored gesture when a control holds a value it cannot store", () => {
    mount();
    const before = field().value;

    choose("pickerGestureModifier", "Bogus");

    expect(field().value).toBe(before);
  });

  test("follows a restore or import", () => {
    mount();
    field().value = stored({ gesture: CLICK_GESTURES.LONG_LEFT, combo: "" });
    document.dispatchEvent(new Event("options-restored"));

    expect(select("pickerGestureButton").value).toBe("long-left-click");
    expect(select("pickerGestureModifier").value).toBe("");
  });

  test("dims its row with its own switch, whatever click-to-save is", () => {
    mount({ pickerOn: false, savesOn: true });
    const group = element("pickerGestureControls");
    expect(group.classList.contains("is-controls-disabled")).toBe(true);

    toggle("contentPickerGesture", true);
    expect(group.classList.contains("is-controls-disabled")).toBe(false);
    toggle("contentClickToSave", false);
    expect(group.classList.contains("is-controls-disabled")).toBe(false);
  });

  test("says when click-to-save already uses the gesture, and stops once it does not", () => {
    // Blank click-to-save bindings mean the legacy pair: Alt with a left click.
    mount({ picker: stored({ gesture: CLICK_GESTURES.LEFT, combo: "Alt" }) });
    expect(status().hidden).toBe(false);

    // The conflict is reported, not refused: the choice is still stored.
    choose("pickerGestureButton", "long-left-click");
    expect(status().hidden).toBe(false);
    expect(parseClickToSaveBindings(field().value)).toEqual([
      { gesture: CLICK_GESTURES.LONG_LEFT, combo: "Alt" },
    ]);

    choose("pickerGestureButton", "middle-click");
    expect(status().hidden).toBe(true);

    // Applying a click-to-save gesture onto the picker's raises it again.
    element<HTMLInputElement>("contentClickToSaveBindings").value = stored(
      { gesture: CLICK_GESTURES.LEFT, combo: "Ctrl" },
      { gesture: CLICK_GESTURES.MIDDLE, combo: "Alt" },
    );
    change(element("contentClickToSaveBindings"));
    expect(status().hidden).toBe(false);

    toggle("contentClickToSave", false);
    expect(status().hidden).toBe(true);
    toggle("contentClickToSave", true);
    expect(status().hidden).toBe(false);
    toggle("contentPickerGesture", false);
    expect(status().hidden).toBe(true);
  });

  test("describes its selects only by the notices on screen", () => {
    const describedBy = () =>
      ["pickerGestureModifier", "pickerGestureModifier2", "pickerGestureButton"].map((id) =>
        select(id).getAttribute("aria-describedby"),
      );
    mount();
    // A hidden status is still reported as a description, so none is named.
    expect(describedBy()).toEqual([null, null, null]);

    choose("pickerGestureModifier", "Alt");
    choose("pickerGestureModifier2", "");
    expect(status().hidden).toBe(false);
    expect(describedBy()).toEqual(Array(3).fill("pickerGestureStatus"));

    choose("pickerGestureButton", "long-left-click");
    expect(describedBy()).toEqual(Array(3).fill("pickerGestureStatus picker-gesture-long-warning"));

    toggle("contentPickerGesture", false);
    expect(describedBy()).toEqual([null, null, null]);
  });

  // These take over ordinary clicks on links and media, as for click-to-save.
  test("warns about a plain left click and about double and long left clicks", () => {
    const shown = () =>
      ["picker-gesture-warning", "picker-gesture-double-warning", "picker-gesture-long-warning"]
        .filter((id) => !element(id).hidden)
        .join();
    mount({ savesOn: false });
    expect(shown()).toBe("");

    choose("pickerGestureModifier2", "");
    choose("pickerGestureModifier", "");
    expect(shown()).toBe("picker-gesture-warning");
    choose("pickerGestureButton", "middle-click");
    expect(shown()).toBe("");
    choose("pickerGestureButton", "double-left-click");
    expect(shown()).toBe("picker-gesture-double-warning");
    choose("pickerGestureModifier", "Ctrl");
    choose("pickerGestureButton", "long-left-click");
    expect(shown()).toBe("picker-gesture-long-warning");
    toggle("contentPickerGesture", false);
    expect(shown()).toBe("");
  });

  test("reads a legacy click-to-save button it does not know as a left click", () => {
    mount({ picker: stored({ gesture: CLICK_GESTURES.LEFT, combo: "Alt" }) });
    element<HTMLInputElement>("contentClickToSaveButton").value = "MIDDLE_CLICK";
    change(element("contentClickToSaveButton"));
    expect(status().hidden).toBe(true);

    element<HTMLInputElement>("contentClickToSaveButton").value = "garbage";
    change(element("contentClickToSaveButton"));
    expect(status().hidden).toBe(false);
  });

  test("works without a status element or its group", () => {
    mount();
    status().remove();
    element("picker-gesture-warning").remove();
    element("pickerGestureControls").replaceWith(...element("pickerGestureControls").childNodes);
    setupPickerGesture();

    expect(() => choose("pickerGestureButton", "middle-click")).not.toThrow();
    expect(parseClickToSaveBindings(field().value)?.[0]?.gesture).toBe(CLICK_GESTURES.MIDDLE);
  });
});
