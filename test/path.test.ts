import * as Path from "../src/routing/path.ts";
import { PATH_SEGMENT_TYPES } from "../src/shared/constants.ts";
// path.ts reads options.replacementChar at call time; seed the real options bag
// here (replacementChar "_") the way the entry does at startup.
import { options } from "../src/config/options-data.ts";
import { seedOptions } from "../src/config/option.ts";

seedOptions();

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

  test("control characters", () => {
    // :pagetitle:/selection text can carry raw newlines/tabs that Windows
    // filenames can't contain (GH #221)
    expect(Path.replaceFsBadChars("a\tb\nc\rd\x01e\x1ff\x00g")).toBe("a_b_c_d_e_f_g");
  });

  describe("trailing dots and spaces", () => {
    test("trims a trailing dot from a sanitized segment", () => {
      expect(new Path.Path("dir./sub").finalize()).toBe("dir/sub");
    });

    test("trims trailing spaces from a sanitized segment", () => {
      expect(new Path.Path("dir /sub").finalize()).toBe("dir/sub");
    });

    test("trims a run of trailing dots and spaces", () => {
      expect(Path.sanitizeFilename("name. . ", 0, false)).toBe("name");
    });
  });

  describe("reserved Windows device names", () => {
    test.each(["CON", "con", "PRN", "AUX", "NUL", "COM1", "com9", "LPT1", "lpt9"])(
      "prefixes the bare reserved name %s with the replacement character",
      (name) => {
        expect(Path.sanitizeFilename(name, 0, false)).toBe(`_${name}`);
      },
    );

    test("prefixes a reserved name that has an extension", () => {
      expect(Path.sanitizeFilename("con.txt", 0, false)).toBe("_con.txt");
    });

    test("leaves names that merely start with a reserved prefix alone", () => {
      expect(Path.sanitizeFilename("console.txt", 0, false)).toBe("console.txt");
      expect(Path.sanitizeFilename("company", 0, false)).toBe("company");
    });

    test("leaves COM0/COM10/LPT0/LPT10 alone (not reserved)", () => {
      expect(Path.sanitizeFilename("COM10", 0, false)).toBe("COM10");
      expect(Path.sanitizeFilename("COM0", 0, false)).toBe("COM0");
      expect(Path.sanitizeFilename("LPT10", 0, false)).toBe("LPT10");
    });

    test("round-trips a reserved name through Path.finalize", () => {
      expect(new Path.Path("con.txt").finalize()).toBe("_con.txt");
    });
  });

  describe("custom replacement character", () => {
    beforeAll(() => {
      options.replacementChar = "x";
    });

    afterAll(() => {
      options.replacementChar = "_";
    });

    test("replaces invalid characters with a custom replacement character", () => {
      expect(new Path.Path(":stop:").finalize()).toBe("xstopx");
      expect(Path.replaceFsBadChars("/", "a")).toBe("a");
    });

    test("prefixes reserved device names with the custom replacement character", () => {
      expect(new Path.Path("con.txt").finalize()).toBe("xcon.txt");
    });
  });

  describe("empty segments", () => {
    test("empty segments become the replacement character", () => {
      const p = new Path.Path("a");
      p.buf = [Path.stringSegment("")];
      expect(p.finalize()).toBe("_");
    });

    test("empty segments fall back to underscore without a replacementChar", () => {
      // Exercise the runtime fallback for older/incomplete persisted options.
      delete (options as { replacementChar?: string }).replacementChar;
      try {
        const p = new Path.Path("a");
        p.buf = [Path.stringSegment("")];
        expect(p.finalize()).toBe("_");
      } finally {
        options.replacementChar = "_";
      }
    });
  });
});

describe("PathSegment", () => {
  test("String coerces null and undefined to empty strings", () => {
    expect(Path.stringSegment(null).val).toBe("");
    expect(Path.stringSegment(undefined).val).toBe("");
    expect(Path.stringSegment(0).val).toBe("0");
  });
});

describe("truncateIfLongerThan", () => {
  test("truncates strings longer than max", () => {
    expect(Path.truncateIfLongerThan("abcdef", 3)).toBe("abc");
  });

  test("uses UTF-8 bytes rather than JavaScript string length", () => {
    expect(Path.truncateIfLongerThan("éé", 3)).toBe("é");
    expect(Path.truncateIfLongerThan("a😀b", 5)).toBe("a😀");
  });

  test("leaves short strings and unlimited maxes alone", () => {
    expect(Path.truncateIfLongerThan("ab", 5)).toBe("ab");
    expect(Path.truncateIfLongerThan("ab", 0)).toBe("ab");
    expect(Path.truncateIfLongerThan("", 3)).toBe("");
  });
});

describe("filename byte diagnostics", () => {
  test("reports UTF-8 byte length and configured-limit overflow", () => {
    expect(Path.getFilenameDiagnostics("é.txt", 5)).toEqual({
      utf8Bytes: 6,
      limitBytes: 5,
      exceedsLimit: true,
    });
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

  test("trims trailing dots", () => {
    expect(Path.sanitizeFilename("file.", 0, false)).toBe("file");
  });

  test("trims trailing spaces", () => {
    expect(Path.sanitizeFilename("file   ", 0, false)).toBe("file");
  });

  test("strips control characters", () => {
    expect(Path.sanitizeFilename("a\x01b\x1fc", 0, false)).toBe("a_b_c");
  });

  test("neutralizes reserved device names", () => {
    expect(Path.sanitizeFilename("CON", 0, false)).toBe("_CON");
    expect(Path.sanitizeFilename("con.txt", 0, false)).toBe("_con.txt");
  });

  test("keeps the configured maximum after neutralizing a reserved name", () => {
    expect(Path.sanitizeFilename("CON.txt", 7, false)).toHaveLength(7);
  });

  test("does not recreate a reserved name when a custom replacement is truncated", () => {
    const previous = options.replacementChar;
    options.replacementChar = "CON";
    try {
      expect(Path.sanitizeFilename("CONSOLE", 3, false)).toBe("_CO");
    } finally {
      options.replacementChar = previous;
    }
  });

  test("does not split a Unicode surrogate pair when truncating", () => {
    expect(Path.sanitizeFilename("ab😀cd", 3, false)).toBe("ab");
  });

  test("preserves a file extension within the UTF-8 byte budget", () => {
    expect(Path.sanitizeFilename("界界界.txt", 8, false, true)).toBe("界.txt");
    expect(Path.getFilenameDiagnostics("界.txt", 8).exceedsLimit).toBe(false);
  });

  test("keeps a nonempty safe component when the first code point exceeds the byte limit", () => {
    expect(Path.sanitizeFilename("界", 1, false)).toBe("_");
  });
});

describe("Path.finalize component semantics", () => {
  test("sanitizes and truncates a completed interpolated component once", () => {
    const previous = options.truncateLength;
    options.truncateLength = 8;
    try {
      const path = new Path.Path("prefix-:filename:");
      path.buf = [Path.stringSegment("prefix-"), Path.stringSegment("long-name.txt")];
      expect(path.finalize()).toBe("prefix-l");
    } finally {
      options.truncateLength = previous;
    }
  });

  test("only trims dots and spaces at the end of a completed component", () => {
    const path = new Path.Path("");
    path.buf = [Path.stringSegment("name."), Path.stringSegment("-final")];
    expect(path.finalize()).toBe("name.-final");
  });

  test("limits every completed component by UTF-8 bytes", () => {
    const previous = options.truncateLength;
    options.truncateLength = 8;
    try {
      expect(new Path.Path("目录目录/file").finalize()).toBe("目录/file");
    } finally {
      options.truncateLength = previous;
    }
  });

  test("does not collapse multibyte components under a one-byte limit", () => {
    const previous = options.truncateLength;
    options.truncateLength = 1;
    try {
      expect(new Path.Path("界/界").finalize()).toBe("_/_");
    } finally {
      options.truncateLength = previous;
    }
  });

  test("can preserve the final component's extension", () => {
    const previous = options.truncateLength;
    options.truncateLength = 8;
    try {
      expect(new Path.Path("folder/界界界.txt").finalize({ finalComponentIsFilename: true })).toBe(
        "folder/界.txt",
      );
    } finally {
      options.truncateLength = previous;
    }
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

  test("segments with reserved device names are invalid", () => {
    const result = new Path.Path("a/con.txt").validate();
    expect(result.valid).toBe(false);
    expect(result.message).toBeDefined();
  });

  test("segments with trailing dots or spaces are invalid", () => {
    expect(new Path.Path("a/dir.").validate().valid).toBe(false);
    expect(new Path.Path("a/dir ").validate().valid).toBe(false);
  });
});

describe("sanitizeBufStrings", () => {
  test("keeps a leading '.' segment", () => {
    expect(new Path.Path("./x").finalize()).toBe("./x");
  });

  test("passes unknown-type segments through unchanged", () => {
    const seg = { type: undefined, val: "anything" };
    const out = Path.sanitizeBufStrings([seg]);
    expect(out[0]!).toBe(seg);
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
    expect(parsed[0]!.val).toBe("abc");
    expect(parsed[0]!.type).toBe(PATH_SEGMENT_TYPES.STRING);
  });
});
