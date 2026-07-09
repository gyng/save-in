const menu = (await import("../src/menu.js")).default;
const constants = (await import("../src/constants.js")).default;

describe("menu parsing", () => {
  beforeAll(async () => {
    global.SPECIAL_DIRS = constants.SPECIAL_DIRS;
    global.PATH_SEGMENT_TYPES = constants.PATH_SEGMENT_TYPES;
    global.Path = (await import("../src/path.js")).default;
  });

  test("parses comments for metadata", () => {
    const input = "(alias: doggo is (cute!)) cats (foo:bar)";
    const actual = menu.parseMeta(input);

    const expected = {
      alias: "doggo is (cute!)",
      foo: "bar",
    };
    expect(actual).toEqual(expected);
  });

  test("parses path for comments", () => {
    const input = "> i/foo/bar // comment (alias: baz)";
    const actual = menu.parsePath(input);

    const expected = {
      raw: input,
      comment: "comment (alias: baz)",
      depth: 1,
      meta: {
        alias: "baz",
      },
      parsedDir: "i/foo/bar",
      validation: {
        valid: true,
      },
    };

    expect(actual).toEqual(expected);
  });
});
