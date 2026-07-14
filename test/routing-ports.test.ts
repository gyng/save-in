import { routingPorts } from "../src/routing/ports.ts";

test("routing port defaults are safe before a browser adapter is configured", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  expect(routingPorts.getMessage("key")).toBe("key");
  expect(routingPorts.getCurrentTab()).toBeUndefined();
  expect(routingPorts.isDebug()).toBe(false);
  expect(routingPorts.recordRuleErrors([])).toBeUndefined();
  routingPorts.logDebug("debug");
  expect(log).toHaveBeenCalledWith("debug");
  await expect(routingPorts.nextCounter()).rejects.toThrow(
    "Routing counter has not been configured",
  );
  await expect(routingPorts.nextPrivateCounter()).rejects.toThrow(
    "Private routing counter has not been configured",
  );
  await expect(routingPorts.peekCounter()).rejects.toThrow(
    "Routing counter has not been configured",
  );
  await expect(routingPorts.resolveContent("https://example.com")).resolves.toBeNull();
  const operation = vi.fn(async () => "protected");
  await expect(
    routingPorts.withRequestReferer(
      "https://example.com/file",
      "https://example.com/page",
      operation,
      ["head", "get"],
    ),
  ).resolves.toBe("protected");
  expect(operation).toHaveBeenCalledOnce();
});
