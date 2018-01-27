const constants = require("../src/constants.js");

Object.assign(global, constants);

const path = require("../src/path.js");

global.Path = path;
global.options = { replacementChar: "_" };

describe("sanitisation", () => {
  test("paths", () => {
    expect(new Path.Path(":stop:").finalize()).toBe("_stop_");
    expect(new Path.Path(":date:").finalize()).toBe("_date_");
    expect(new Path.Path("/:stop:/::/").finalize()).toBe("/_stop_/__/");
    expect(new Path.Path("/:date:/dog").finalize()).toBe("/_date_/dog");
    expect(new Path.Path("/aa/b/c").finalize()).toBe("/aa/b/c");
    expect(new Path.Path("ab/b/c").finalize()).toBe("ab/b/c");
    expect(new Path.Path("a\\b/c").finalize()).toBe("a/b/c");
  });

  test("filesystem characters", () => {
    expect(Path.replaceFsBadChars('/ : * ? " < > | % ~')).toBe(
      "_ _ _ _ _ _ _ _ % ~"
    );
  });

  describe("custom replacement character", () => {
    const oldOptions = global.options;
    beforeAll(() => {
      global.options = { replacementChar: "x" };
    });

    afterAll(() => {
      global.options = oldOptions;
    });

    test("replaces invalid characters with a custom replacement character", () => {
      expect(new Path.Path(":stop:").finalize()).toBe("xstopx");
      expect(Path.replaceFsBadChars("/", "a")).toBe("a");
    });
  });
});
