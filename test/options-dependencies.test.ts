// @vitest-environment jsdom
import { setupOptionDependencies } from "../src/options/options-dependencies.ts";

describe("option dependencies", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input type="checkbox" id="contentClickToSave">
      <input id="contentClickToSaveCombo">
      <select id="clickToSaveModifier"></select>
      <select id="clickToSaveModifier2"></select>
      <select id="contentClickToSaveButton"></select>
      <input type="checkbox" id="tabEnabled">
      <input type="checkbox" id="closeTabOnSave">
      <input type="checkbox" id="trackBrowserDownloads">
      <input type="checkbox" id="routeBrowserDownloads">
      <input type="checkbox" id="setRefererHeader">
      <textarea id="setRefererHeaderFilter"></textarea>
      <input type="checkbox" id="links">
      <input type="checkbox" id="preferLinks">
      <input type="checkbox" id="preferLinksFilterEnabled">
      <textarea id="preferLinksFilter"></textarea>`;
  });

  test("disables children until their parent feature is enabled", () => {
    setupOptionDependencies();
    expect((document.querySelector("#contentClickToSaveCombo") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((document.querySelector("#clickToSaveModifier") as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect((document.querySelector("#closeTabOnSave") as HTMLInputElement).disabled).toBe(true);
    expect(
      (document.querySelector("#setRefererHeaderFilter") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect((document.querySelector("#preferLinks") as HTMLInputElement).disabled).toBe(true);
  });

  test("updates immediately and respects the full preferred-link dependency chain", () => {
    setupOptionDependencies();
    const links = document.querySelector("#links") as HTMLInputElement;
    const prefer = document.querySelector("#preferLinks") as HTMLInputElement;
    const filterEnabled = document.querySelector("#preferLinksFilterEnabled") as HTMLInputElement;
    const filter = document.querySelector("#preferLinksFilter") as HTMLTextAreaElement;

    links.checked = true;
    links.dispatchEvent(new Event("change"));
    expect(prefer.disabled).toBe(false);
    prefer.checked = true;
    prefer.dispatchEvent(new Event("change"));
    expect(filterEnabled.disabled).toBe(false);
    filterEnabled.checked = true;
    filterEnabled.dispatchEvent(new Event("change"));
    expect(filter.disabled).toBe(false);
  });

  test("keeps children disabled when a checked parent is unavailable", () => {
    const tab = document.querySelector("#tabEnabled") as HTMLInputElement;
    const close = document.querySelector("#closeTabOnSave") as HTMLInputElement;
    tab.checked = true;
    tab.disabled = true;

    const update = setupOptionDependencies();
    update();

    expect(close.disabled).toBe(true);
  });
});
