/* eslint-disable no-underscore-dangle */
const constants = require("../src/constants.js");

Object.assign(global, constants);

const path = require("../src/path.js");

global.Path = path;
global.options = { replacementChar: "_" };

describe("sanitisation", () => {
  test("paths", () => {
    expect(new path._Path(":stop:").finalize()).toBe("_stop_");
    expect(new path._Path(":date:").finalize()).toBe("_date_");
    expect(new path._Path("/:stop:/::/").finalize()).toBe("/_stop_/__/");
    expect(new path._Path("/:date:/dog").finalize()).toBe("/_date_/dog");
    expect(new path._Path("/aa/b/c").finalize()).toBe("/aa/b/c");
    expect(new path._Path("ab/b/c").finalize()).toBe("ab/b/c");
    expect(new path._Path("a\\b/c").finalize()).toBe("a/b/c");
  });

  test("filesystem characters", () => {
    expect(path.Path.replaceFsBadChars('/ : * ? " < > | % ~')).toBe(
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
      expect(new path._Path(":stop:").finalize()).toBe("xstopx");
      expect(path.Path.replaceFsBadChars("/", "a")).toBe("a");
    });
  });
});
