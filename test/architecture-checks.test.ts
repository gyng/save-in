import checks from "../scripts/lib/architecture-checks.js";

const {
  callsIdentifier,
  hasBrowserListenerRegistration,
  hasDynamicImport,
  hasGlobalNamespaceMutation,
} = checks;

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

describe("architecture module scanner", () => {
  test("detects dynamic imports without confusing type import declarations", () => {
    expect(hasDynamicImport('const module = await import("./feature.ts")')).toBe(true);
    expect(hasDynamicImport('import type { Feature } from "./feature.ts"')).toBe(false);
  });

  test("detects direct mutation of the global namespace", () => {
    expect(hasGlobalNamespaceMutation("Object.assign(globalThis, { Feature })")).toBe(true);
    expect(hasGlobalNamespaceMutation("globalThis.Feature = Feature")).toBe(true);
    expect(hasGlobalNamespaceMutation("Object.defineProperty(globalThis, 'Feature', {})")).toBe(
      true,
    );
    expect(hasGlobalNamespaceMutation("const host = globalThis.browser")).toBe(false);
    expect(hasGlobalNamespaceMutation("globalThis.browser === chrome")).toBe(false);
    expect(hasGlobalNamespaceMutation("window.Feature = Feature")).toBe(true);
    expect(hasGlobalNamespaceMutation("self.Feature = Feature")).toBe(true);
  });

  test("detects composition calls by identifier", () => {
    expect(callsIdentifier("configureRoutingPorts({ getMessage })", "configureRoutingPorts")).toBe(
      true,
    );
    expect(
      callsIdentifier(
        "const configureRoutingPorts = (ports) => Object.assign(target, ports)",
        "configureRoutingPorts",
      ),
    ).toBe(false);
  });
});
