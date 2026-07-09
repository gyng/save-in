const constants = (await import("../src/constants.js")).default;

Object.assign(global, constants);

const path = (await import("../src/path.js")).default;

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
    expect(Path.replaceFsBadChars('/ : * ? " < > | % ~')).toBe("_ _ _ _ _ _ _ _ % ~");
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

  describe("empty segments", () => {
    test("empty segments become the replacement character", () => {
      const p = new Path.Path("a");
      p.buf = [Path.PathSegment.String("")];
      expect(p.finalize()).toBe("_");
    });

    test("empty segments fall back to underscore without a replacementChar", () => {
      const oldOptions = global.options;
      global.options = {};
      try {
        const p = new Path.Path("a");
        p.buf = [Path.PathSegment.String("")];
        expect(p.finalize()).toBe("_");
      } finally {
        global.options = oldOptions;
      }
    });
  });
});

describe("PathSegment", () => {
  test("String coerces null and undefined to empty strings", () => {
    expect(Path.PathSegment.String(null).val).toBe("");
    expect(Path.PathSegment.String(undefined).val).toBe("");
    expect(Path.PathSegment.String(0).val).toBe("0");
  });
});

describe("truncateIfLongerThan", () => {
  test("truncates strings longer than max", () => {
    expect(Path.truncateIfLongerThan("abcdef", 3)).toBe("abc");
  });

  test("leaves short strings and unlimited maxes alone", () => {
    expect(Path.truncateIfLongerThan("ab", 5)).toBe("ab");
    expect(Path.truncateIfLongerThan("ab", 0)).toBe("ab");
    expect(Path.truncateIfLongerThan("", 3)).toBe("");
  });
});

describe("sanitizeFilename", () => {
  test("empty input is returned as-is", () => {
    expect(Path.sanitizeFilename("")).toBe("");
    expect(Path.sanitizeFilename(null)).toBe(null);
  });

  test("truncates to max length", () => {
    expect(Path.sanitizeFilename("abcdef", 4)).toBe("abcd");
  });

  test("replaces leading dots unless allowed", () => {
    expect(Path.sanitizeFilename(".dotfile")).toBe("_dotfile");
    expect(Path.sanitizeFilename(".dotfile", 0, false)).toBe(".dotfile");
  });
});

describe("Path.validate", () => {
  test("a missing buffer is invalid", () => {
    const p = new Path.Path("a");
    p.buf = null;
    expect(p.validate()).toEqual({ valid: false });
  });

  test("'.'-prefixed paths are valid", () => {
    expect(new Path.Path("./sub").validate()).toEqual({ valid: true });
  });

  test("absolute paths are invalid", () => {
    const result = new Path.Path("/abs").validate();
    expect(result.valid).toBe(false);
    expect(result.message).toBeDefined();
  });

  test("parent-relative paths are invalid", () => {
    expect(new Path.Path("../up").validate().valid).toBe(false);
  });

  test("segments with invalid characters are invalid", () => {
    const result = new Path.Path("a/b:c").validate();
    expect(result.valid).toBe(false);
    expect(result.message).toBeDefined();
  });

  test("plain relative paths are valid", () => {
    expect(new Path.Path("a/b").validate()).toEqual({ valid: true });
  });
});

describe("sanitizeBufStrings", () => {
  test("keeps a leading '.' segment", () => {
    expect(new Path.Path("./x").finalize()).toBe("./x");
  });

  test("passes unknown-type segments through unchanged", () => {
    const seg = { type: undefined, val: "anything" };
    const out = Path.sanitizeBufStrings([seg]);
    expect(out[0]).toBe(seg);
  });
});

describe("parsePathStr", () => {
  test("null yields an empty path", () => {
    expect(Path.parsePathStr(null)).toEqual([]);
    expect(Path.parsePathStr()).toEqual([]);
  });

  test("wraps a bare string returned from a custom split()", () => {
    // defensive branch: unreachable for real strings, whose split()
    // always returns an array
    const parsed = Path.parsePathStr({ split: () => "abc" });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].val).toBe("abc");
    expect(parsed[0].type).toBe(global.PATH_SEGMENT_TYPES.STRING);
  });
});
