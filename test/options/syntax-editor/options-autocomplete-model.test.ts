import {
  applySuggestion,
  matcherStrategy,
  pathVariableStrategy,
  routerVariableStrategy,
  suggestFor,
} from "../../../src/options/syntax-editor/autocomplete.ts";

const VARIABLES = [":date:", ":day:", ":pagetitle:"];
const MATCHERS = ["fileext", "filename", "into"];

describe("suggestFor", () => {
  test("suggests variables for a :prefix in the paths box", () => {
    const result = suggestFor("images/:d", [pathVariableStrategy(VARIABLES)]);
    expect(result!.suggestions).toEqual([":date:", ":day:"]);
  });

  test("suggests matchers at the start of a rule line", () => {
    const result = suggestFor("some: rule\nfile", [matcherStrategy(MATCHERS)]);
    expect(result!.suggestions).toEqual(["fileext", "filename"]);
  });

  test("suggests variables inside an into: clause", () => {
    const result = suggestFor("filename: x\ninto: dir/:pa", [routerVariableStrategy(VARIABLES)]);
    expect(result!.suggestions).toEqual([":pagetitle:"]);
  });

  test("returns null when nothing matches", () => {
    expect(suggestFor("plain text ", [pathVariableStrategy(VARIABLES)])).toBeNull();
    expect(suggestFor("images/:zz", [pathVariableStrategy(VARIABLES)])).toBeNull();
  });

  test("opens on a bare colon at a token boundary", () => {
    expect(suggestFor("images/:", [pathVariableStrategy(VARIABLES)])!.suggestions).toEqual(
      VARIABLES,
    );
    expect(suggestFor("a :", [pathVariableStrategy(VARIABLES)])!.suggestions).toEqual(VARIABLES);
    expect(suggestFor("x\n:", [pathVariableStrategy(VARIABLES)])!.suggestions).toEqual(VARIABLES);
  });

  test("does not open on a colon that follows a letter or digit", () => {
    expect(suggestFor("notes:d", [pathVariableStrategy(VARIABLES)])).toBeNull();
    expect(suggestFor("2024:d", [pathVariableStrategy(VARIABLES)])).toBeNull();
    expect(suggestFor("into: v1:2:d", [routerVariableStrategy(VARIABLES)])).toBeNull();
  });

  test("falls through to later strategies", () => {
    const result = suggestFor("filename: x\ninto: :d", [
      matcherStrategy(MATCHERS),
      routerVariableStrategy(VARIABLES),
    ]);
    expect(result!.suggestions).toEqual([":date:", ":day:"]);
  });

  test("skips a matching strategy that does not expose a completion term", () => {
    const incomplete = {
      match: /plain$/,
      suggest: vi.fn(() => ["unused"]),
      insert: (_prefix: string, name: string) => name,
    };
    expect(suggestFor("plain", [incomplete, pathVariableStrategy(VARIABLES)])).toBeNull();
    expect(incomplete.suggest).not.toHaveBeenCalled();
  });
});

describe("applySuggestion", () => {
  test("replaces the typed prefix with the chosen variable", () => {
    const value = "images/:d\nvideos";
    const result = suggestFor("images/:d", [pathVariableStrategy(VARIABLES)]);
    const applied = applySuggestion(value, 9, result!, ":date:");

    expect(applied.value).toBe("images/:date:\nvideos");
    expect(applied.caret).toBe(13);
  });

  test("appends the matcher delimiter", () => {
    const value = "fil";
    const result = suggestFor(value, [matcherStrategy(MATCHERS)]);
    const applied = applySuggestion(value, 3, result!, "fileext");

    expect(applied.value).toBe("fileext: ");
    expect(applied.caret).toBe(9);
  });

  test.each([
    ["excl", "exclude", "exclude: true"],
    ["tab", "tab", "tab: close"],
  ])("completes the fixed %s action value", (typed, chosen, expected) => {
    const result = suggestFor(typed, [matcherStrategy(["exclude", "tab"])]);

    expect(applySuggestion(typed, typed.length, result!, chosen)).toEqual({
      value: expected,
      caret: expected.length,
    });
  });

  test("applies a router variable and a strategy without a prefix capture", () => {
    const routerValue = "filename: x\ninto: :d";
    const routerResult = suggestFor(routerValue, [routerVariableStrategy(VARIABLES)])!;
    expect(applySuggestion(routerValue, routerValue.length, routerResult, ":date:")).toEqual({
      value: "filename: x\ninto: :date:",
      caret: 24,
    });

    const strategy = {
      match: /(x)(y)$/,
      suggest: () => ["z"],
      insert: (prefix: string, name: string) => `${prefix}${name}`,
    };
    const result = suggestFor("xy", [strategy])!;
    Reflect.deleteProperty(result.match, "1");
    expect(applySuggestion("xy", 2, result, "z")).toEqual({ value: "z", caret: 1 });
  });
});
