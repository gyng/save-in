import checks from "../scripts/lib/architecture-checks.js";

const { hasBrowserListenerRegistration } = checks;

describe("architecture listener registration scanner", () => {
  test("detects direct and optional-chain registrations", () => {
    expect(hasBrowserListenerRegistration("browser.tabs.onUpdated.addListener(fn)")).toBe(true);
    expect(hasBrowserListenerRegistration("browser.tabs?.onUpdated?.addListener(fn)")).toBe(true);
  });

  test("detects destructured and assigned aliases", () => {
    expect(
      hasBrowserListenerRegistration("const { addListener: subscribe } = event; subscribe(fn)"),
    ).toBe(true);
    expect(
      hasBrowserListenerRegistration("const subscribe = event.addListener; subscribe(fn)"),
    ).toBe(true);
  });

  test("does not confuse ordinary event handling with registration", () => {
    expect(hasBrowserListenerRegistration("element.addEventListener('click', fn)")).toBe(false);
    expect(hasBrowserListenerRegistration("event.removeListener(fn)")).toBe(false);
  });
});
