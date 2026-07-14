import { configureBackgroundPorts } from "../src/background/ports.ts";
import { backgroundRuntime } from "../src/background/runtime.ts";
import { routingPorts } from "../src/routing/ports.ts";

beforeEach(() => {
  backgroundRuntime.debug = false;
  backgroundRuntime.optionErrors = { paths: [], filenamePatterns: [] };
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
