const menu = require("../src/menu.js");
const constants = require("../src/constants.js");

describe("menu parsing", () => {
  beforeAll(() => {
    global.SPECIAL_DIRS = constants.SPECIAL_DIRS;
    global.PATH_SEGMENT_TYPES = constants.PATH_SEGMENT_TYPES;
    global.Path = require("../src/path.js"); // eslint-disable-line
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
