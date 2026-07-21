import { configureBackgroundPorts } from "../../src/background/ports.ts";
import { backgroundRuntime } from "../../src/background/runtime.ts";
import { options } from "../../src/config/options-data.ts";
import { routingPorts } from "../../src/routing/ports.ts";
import { downloadPorts } from "../../src/downloads/ports.ts";
import { menuState } from "../../src/background/menu-build.ts";

beforeEach(() => {
  backgroundRuntime.debug = false;
  backgroundRuntime.optionErrors = { paths: [], filenamePatterns: [] };
  options.persistPrivateActivity = false;
  options.enableLastLocation = false;
  menuState.lastUsedPath = null;
  menuState.lastUsedMeta = null;
  vi.mocked(browser.storage.local.set).mockClear();
  vi.mocked(browser.contextMenus.update).mockClear();
});

test("wires routing ports to background-owned services", async () => {
  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

  configureBackgroundPorts();
  expect(routingPorts.getCurrentTab()).toBeNull();
  expect(routingPorts.isDebug()).toBe(false);
  const error = { message: "Invalid rule", error: "bad rule" };
  routingPorts.recordRuleErrors([error]);
  expect(backgroundRuntime.optionErrors.filenamePatterns).toEqual([error]);
  routingPorts.logDebug("route", 1);
  expect(consoleLog).toHaveBeenCalledWith("route", 1);
  await expect(routingPorts.nextCounter()).resolves.toBe(1);
  await expect(routingPorts.nextPrivateCounter()).resolves.toBe(2);
  await expect(routingPorts.peekCounter()).resolves.toBe(1);
});

test("uses the durable counter for opted-in private activity", async () => {
  options.persistPrivateActivity = true;
  configureBackgroundPorts();

  // The durable path advances past the isolated private value from the prior
  // save instead of reusing a filename counter when the option changes.
  await expect(routingPorts.nextPrivateCounter()).resolves.toBe(3);
  await expect(routingPorts.peekCounter()).resolves.toBe(3);
});

test("wires browser Save As folders to the Last used menu state", async () => {
  options.enableLastLocation = true;
  configureBackgroundPorts();

  await expect(downloadPorts.updateBrowserLastUsed?.("Work")).resolves.toBe(true);

  expect(browser.storage.local.set).toHaveBeenCalledWith({
    lastUsedPath: "Work",
    lastUsedMeta: { title: "Work" },
  });
  expect(browser.contextMenus.update).toHaveBeenCalled();
});

test("updates stored Last used without touching a hidden menu item", async () => {
  options.enableLastLocation = false;
  configureBackgroundPorts();
  vi.mocked(browser.contextMenus.update).mockClear();

  await expect(downloadPorts.updateBrowserLastUsed?.("Work")).resolves.toBe(true);

  expect(browser.storage.local.set).toHaveBeenCalled();
  expect(browser.contextMenus.update).not.toHaveBeenCalled();
});

test("does not rewrite or rerender an unchanged browser Last used folder", async () => {
  options.enableLastLocation = true;
  configureBackgroundPorts();
  await downloadPorts.updateBrowserLastUsed?.("Work");
  vi.mocked(browser.storage.local.set).mockClear();
  vi.mocked(browser.contextMenus.update).mockClear();

  await expect(downloadPorts.updateBrowserLastUsed?.("Work")).resolves.toBe(true);

  expect(browser.storage.local.set).not.toHaveBeenCalled();
  expect(browser.contextMenus.update).not.toHaveBeenCalled();
});

test("refuses a native folder that Save In cannot safely reuse", async () => {
  options.enableLastLocation = true;
  configureBackgroundPorts();
  vi.mocked(browser.storage.local.set).mockClear();

  await expect(downloadPorts.updateBrowserLastUsed?.(".hidden")).resolves.toBe(false);

  expect(browser.storage.local.set).not.toHaveBeenCalled();
  expect(browser.contextMenus.update).not.toHaveBeenCalled();
});
