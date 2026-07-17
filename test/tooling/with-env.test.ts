import { describe, expect, it } from "vitest";

const { prepareCommand, resolveLocalBin } = require("../../scripts/with-env.js");

describe("with-env", () => {
  it("applies assignments and removals without mutating the parent environment", () => {
    const parent = { KEEP: "yes", REMOVE: "secret" };

    const result = prepareCommand(
      ["-u", "REMOVE", "EXT_DIR=dist/bundled-pkg", "--", "vitest", "run"],
      parent,
    );

    expect(result).toEqual({
      command: "vitest",
      args: ["run"],
      env: { KEEP: "yes", EXT_DIR: "dist/bundled-pkg" },
    });
    expect(parent).toEqual({ KEEP: "yes", REMOVE: "secret" });
  });

  it("requires a command after the environment options", () => {
    expect(() => prepareCommand(["-u", "TOKEN"], {})).toThrow("Missing command");
  });

  it("resolves installed package binaries without a shell", () => {
    expect(resolveLocalBin("web-ext")).toMatch(/node_modules[\\/]web-ext[\\/].*\.js$/);
    expect(resolveLocalBin("not-installed-save-in-tool")).toBeNull();
  });
});
