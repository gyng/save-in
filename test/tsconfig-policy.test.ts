import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const readConfig = (name: string): Record<string, unknown> => {
  const jsonc = fs.readFileSync(path.join(root, name), "utf8");
  return JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
};

const compilerOptions = (name: string): Record<string, unknown> =>
  (readConfig(name).compilerOptions as Record<string, unknown> | undefined) ?? {};

describe("TypeScript policy", () => {
  test("keeps strict production boundary checks enabled", () => {
    const base = compilerOptions("tsconfig.json");
    const browser = compilerOptions("tsconfig.browser.json");

    expect(base).toMatchObject({
      strict: true,
      skipLibCheck: false,
      forceConsistentCasingInFileNames: true,
      noFallthroughCasesInSwitch: true,
      noImplicitReturns: true,
    });
    expect(base).not.toHaveProperty("allowJs");
    expect(base).not.toHaveProperty("checkJs");
    expect(browser).toMatchObject({
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
    });
  });

  test("checks the Chrome background entry without DOM globals", () => {
    const worker = compilerOptions("tsconfig.worker.json");
    expect(worker.lib).toEqual(["es2023", "webworker"]);
    expect(worker.lib).not.toContain("dom");
    expect(readConfig("tsconfig.worker.json").include).toContain("src/entries/background.ts");
  });

  test("checks JavaScript tooling separately from application source", () => {
    const tools = compilerOptions("tsconfig.tools.json");
    expect(tools).toMatchObject({ allowJs: true, checkJs: true, noEmit: true, strict: true });
    for (const strictCheck of [
      "noImplicitAny",
      "strictNullChecks",
      "strictFunctionTypes",
      "strictPropertyInitialization",
      "useUnknownInCatchVariables",
      "noImplicitReturns",
    ]) {
      expect(tools[strictCheck], strictCheck).not.toBe(false);
    }

    const devTools = compilerOptions("tsconfig.dev-tools.json");
    const e2eTools = compilerOptions("tsconfig.e2e.json");
    expect(readConfig("tsconfig.dev-tools.json").extends).toBe("./tsconfig.tools.json");
    expect(readConfig("tsconfig.e2e.json").extends).toBe("./tsconfig.tools.json");
    expect(devTools.strict).not.toBe(false);
    expect(e2eTools.strict).not.toBe(false);
    expect(readConfig("tsconfig.tools.json").include).toContain("scripts/prepare-release.js");
    expect(readConfig("tsconfig.dev-tools.json").include).toContain("scripts/lib/cdp.js");
    expect(readConfig("tsconfig.e2e.json").include).toContain("e2e/**/*.mjs");

    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.typecheck).toContain("tsconfig.worker.json");
    expect(pkg.scripts?.typecheck).toContain("tsconfig.tools.json");
    expect(pkg.scripts?.typecheck).toContain("tsconfig.dev-tools.json");
    expect(pkg.scripts?.typecheck).toContain("tsconfig.e2e.json");
    expect(pkg.scripts?.typecheck).toContain("tsconfig.test.json");
  });

  test("checks application source against both host API declarations", () => {
    const adapter = fs.readFileSync(path.join(root, "src/platform/web-extension-api.ts"), "utf8");
    expect(adapter).toContain("as unknown as SaveInWebExtensionApi");
    expect(readConfig("tsconfig.browser.json").exclude).toContain("types/host-chrome.d.ts");
    expect(readConfig("tsconfig.chrome.json").exclude).toContain("types/host-firefox.d.ts");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.typecheck).toContain("tsconfig.chrome.json");
  });

  test("checks the complete TypeScript test suite with production strictness", () => {
    const tests = compilerOptions("tsconfig.test.json");
    expect(tests).toMatchObject({
      allowJs: true,
      checkJs: true,
    });
    expect(compilerOptions("tsconfig.browser.json")).toMatchObject({
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
    });
    expect(readConfig("tsconfig.test.json").include).toContain("test/**/*.ts");
  });
});
