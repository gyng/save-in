// @vitest-environment jsdom
import { setupOptionDependencies } from "../../../src/options/core/options-dependencies.ts";

describe("option dependencies", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input type="checkbox" id="contentClickToSave">
      <input id="contentClickToSaveCombo">
      <select id="clickToSaveModifier"></select>
      <select id="clickToSaveModifier2"></select>
      <select id="contentClickToSaveButton"></select>
      <input id="contentClickToSaveLongPressMs">
      <input type="checkbox" id="autoDownloadEnabled">
      <input type="checkbox" id="autoDownloadLive">
      <input type="checkbox" id="autoDownloadPrivate">
      <input type="checkbox" id="autoDownloadLinks">
      <input type="checkbox" id="autoDownloadDocuments">
      <input type="checkbox" id="autoDownloadBackgrounds">
      <input type="checkbox" id="autoDownloadManifests">
      <input type="checkbox" id="autoDownloadDataUrls">
      <input id="autoDownloadMaxPerPage">
      <input type="checkbox" id="sourcePanelEnabled">
      <input type="checkbox" id="sourcePanelLive">
      <input type="checkbox" id="sourcePanelPreviews">
      <input type="checkbox" id="sourcePanelBackgrounds">
      <input type="checkbox" id="sourcePanelResourceHints">
      <input type="checkbox" id="sourcePanelLinks">
      <select id="sourcePanelShortcutModifier"></select>
      <select id="sourcePanelShortcutModifier2"></select>
      <input id="sourcePanelShortcutKey">
      <button id="sourcePanelShortcutApply"></button>
      <button id="sourcePanelShortcutReset"></button>
      <input type="checkbox" id="tabEnabled">
      <input type="checkbox" id="closeTabOnSave">
      <input type="checkbox" id="trackBrowserDownloads">
      <input type="checkbox" id="routeBrowserDownloads">
      <input type="checkbox" id="browserDownloadFiltersEnabled">
      <textarea id="browserDownloadFilter"></textarea>
      <textarea id="browserDownloadExcludeFilter"></textarea>
      <input type="checkbox" id="setRefererHeader">
      <textarea id="setRefererHeaderFilter"></textarea>
      <input type="checkbox" id="fallbackFetch">
      <input type="checkbox" id="fetchViaFetch">
      <input type="checkbox" id="includeFetchCredentials">
      <input type="checkbox" id="links">
      <input type="checkbox" id="preferLinks">
      <input type="checkbox" id="preferLinksFilterEnabled">
      <textarea id="preferLinksFilter"></textarea>
      <input type="checkbox" id="routeSkipUnmatched">
      <input type="checkbox" id="routeFailurePrompt">`;
  });

  test("disables children until their parent feature is enabled", () => {
    setupOptionDependencies();
    expect((document.querySelector("#contentClickToSaveCombo") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((document.querySelector("#clickToSaveModifier") as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(
      (document.querySelector("#contentClickToSaveLongPressMs") as HTMLInputElement).disabled,
    ).toBe(true);
    expect((document.querySelector("#closeTabOnSave") as HTMLInputElement).disabled).toBe(true);
    expect(
      (document.querySelector("#setRefererHeaderFilter") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect((document.querySelector("#browserDownloadFilter") as HTMLTextAreaElement).disabled).toBe(
      true,
    );
    expect(
      (document.querySelector("#browserDownloadExcludeFilter") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect((document.querySelector("#preferLinks") as HTMLInputElement).disabled).toBe(true);
    expect((document.querySelector("#autoDownloadLive") as HTMLInputElement).disabled).toBe(true);
    expect((document.querySelector("#autoDownloadLinks") as HTMLInputElement).disabled).toBe(true);
    expect((document.querySelector("#autoDownloadDocuments") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((document.querySelector("#autoDownloadBackgrounds") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((document.querySelector("#autoDownloadManifests") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((document.querySelector("#includeFetchCredentials") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((document.querySelector("#sourcePanelLive") as HTMLInputElement).disabled).toBe(true);
    expect(
      (document.querySelector("#sourcePanelShortcutModifier") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (document.querySelector("#sourcePanelShortcutApply") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("enables Page Sources browsing controls when their master is enabled", () => {
    setupOptionDependencies();
    const enabled = document.querySelector("#sourcePanelEnabled") as HTMLInputElement;
    const live = document.querySelector("#sourcePanelLive") as HTMLInputElement;
    const shortcut = document.querySelector("#sourcePanelShortcutKey") as HTMLInputElement;

    enabled.checked = true;
    enabled.dispatchEvent(new Event("change"));

    expect(live.disabled).toBe(false);
    expect(shortcut.disabled).toBe(false);
  });

  test("enables the automatic scan coverage checkboxes when the master switch is on", () => {
    setupOptionDependencies();
    const enabled = document.querySelector("#autoDownloadEnabled") as HTMLInputElement;
    const documents = document.querySelector("#autoDownloadDocuments") as HTMLInputElement;
    const backgrounds = document.querySelector("#autoDownloadBackgrounds") as HTMLInputElement;
    const manifests = document.querySelector("#autoDownloadManifests") as HTMLInputElement;
    const dataUrls = document.querySelector("#autoDownloadDataUrls") as HTMLInputElement;

    enabled.checked = true;
    enabled.dispatchEvent(new Event("change"));

    expect(documents.disabled).toBe(false);
    expect(backgrounds.disabled).toBe(false);
    expect(manifests.disabled).toBe(false);
    expect(dataUrls.disabled).toBe(false);

    enabled.checked = false;
    enabled.dispatchEvent(new Event("change"));

    expect(documents.disabled).toBe(true);
    expect(backgrounds.disabled).toBe(true);
    expect(manifests.disabled).toBe(true);
    expect(dataUrls.disabled).toBe(true);
  });

  test("enables fetch credentials when either Save In fetch mode is active", () => {
    setupOptionDependencies();
    const fallback = document.querySelector("#fallbackFetch") as HTMLInputElement;
    const direct = document.querySelector("#fetchViaFetch") as HTMLInputElement;
    const credentials = document.querySelector("#includeFetchCredentials") as HTMLInputElement;

    fallback.checked = true;
    fallback.dispatchEvent(new Event("change"));
    expect(credentials.disabled).toBe(false);

    fallback.checked = false;
    fallback.dispatchEvent(new Event("change"));
    expect(credentials.disabled).toBe(true);

    direct.checked = true;
    direct.dispatchEvent(new Event("change"));
    expect(credentials.disabled).toBe(false);
  });

  test("retains browser URL filters while toggling their interaction", () => {
    setupOptionDependencies();
    const enabled = document.querySelector("#browserDownloadFiltersEnabled") as HTMLInputElement;
    const filter = document.querySelector("#browserDownloadFilter") as HTMLTextAreaElement;
    const exclude = document.querySelector("#browserDownloadExcludeFilter") as HTMLTextAreaElement;
    filter.value = "*://allowed.example/*";
    exclude.value = "*://private.example/*";

    enabled.checked = true;
    enabled.dispatchEvent(new Event("change"));
    expect(filter.disabled).toBe(false);
    expect(exclude.disabled).toBe(false);
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change"));

    expect(filter.disabled).toBe(true);
    expect(exclude.disabled).toBe(true);
    expect(filter.value).toBe("*://allowed.example/*");
    expect(exclude.value).toBe("*://private.example/*");
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

  // #100 asked to prefer links on some sites and not others. The engine grants
  // exactly that: menu-target.ts evaluates preferLinksFilterEnabled
  // independently of preferLinks, and menu-resolver.test.ts pins filter-only
  // returning LINK on a matching page and MEDIA elsewhere. But preferLinks
  // prefers links on EVERY page, so the filter can only narrow anything while
  // preferLinks is off — and gating the filter behind it made that one useful
  // configuration the single thing the options page would not let you build.
  test("the page filter is reachable without preferring links everywhere (#100)", () => {
    setupOptionDependencies();
    const links = document.querySelector("#links") as HTMLInputElement;
    const prefer = document.querySelector("#preferLinks") as HTMLInputElement;
    const filterEnabled = document.querySelector("#preferLinksFilterEnabled") as HTMLInputElement;
    const filter = document.querySelector("#preferLinksFilter") as HTMLTextAreaElement;

    links.checked = true;
    links.dispatchEvent(new Event("change"));

    expect(filterEnabled.disabled).toBe(false);
    filterEnabled.checked = true;
    filterEnabled.dispatchEvent(new Event("change"));

    expect(filter.disabled).toBe(false);
    // The whole point: never had to prefer links everywhere to get here.
    expect(prefer.checked).toBe(false);
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

  test("disables the no-match prompt while unmatched files are skipped", () => {
    setupOptionDependencies();
    const skip = document.querySelector("#routeSkipUnmatched") as HTMLInputElement;
    const prompt = document.querySelector("#routeFailurePrompt") as HTMLInputElement;

    expect(prompt.disabled).toBe(false);
    prompt.checked = true;
    skip.checked = true;
    skip.dispatchEvent(new Event("change"));

    expect(prompt.disabled).toBe(true);
    expect(prompt.checked).toBe(true);

    skip.checked = false;
    skip.dispatchEvent(new Event("change"));
    expect(prompt.disabled).toBe(false);
  });

  test("does not treat a checkbox id on the wrong element type as enabled", () => {
    const fakeParent = document.createElement("div");
    fakeParent.id = "tabEnabled";
    Object.assign(fakeParent, { checked: true, disabled: false });
    document.getElementById("tabEnabled")?.replaceWith(fakeParent);

    setupOptionDependencies();

    expect((document.getElementById("closeTabOnSave") as HTMLInputElement).disabled).toBe(true);
  });
});
