const constants = (await import("../src/constants.js")).default;

Object.assign(global, constants);
const router = (await import("../src/router.js")).default;
const Variable = (await import("../src/variable.js")).default;
const Path = (await import("../src/path.js")).default;

global.Path = Path;
global.Download = (await import("../src/download.js")).default;

describe("variables", () => {
  const specialDirs = global.SPECIAL_DIRS;
  const info = {
    url: "http://www.source.com/foobar/file.jpg",
    pageUrl: "http://www.example.com/foobar/",
    sourceUrl: "http://srcurl.com",
    linkText: "linkfoobar",
    selectionText: "selectionfoobar",
    currentTab: { title: "foobartitle" },
    filename: "lol.jpeg",
    now: new Date(),
  };

  beforeAll(() => {
    global.SPECIAL_DIRS = constants.SPECIAL_DIRS;
    global.RULE_TYPES = constants.RULE_TYPES;
    global.currentTab = { title: "foobartitle" };
    global.matchRules = router.matchRules;
    global.options = { replacementChar: "_" };
  });

  afterAll(() => {
    global.SPECIAL_DIRS = specialDirs;
    global.currentTab = undefined;
    global.matchRules = undefined;
  });

  describe("standard variables", () => {
    test("interpolates :date:", () => {
      const input = new Path.Path(":date:/a/b");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output.startsWith(info.now.getFullYear()));
      expect(output.split("-")).toHaveLength(3);
    });

    test("interpolates :unixdate:", () => {
      const timestamp = Math.floor(info.now / 1000);
      const input = new Path.Path(":unixdate:/a/b");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe(`${timestamp}/a/b`);
    });

    test("interpolates :isodate:", () => {
      const now = new Date();
      const input = new Path.Path(":isodate:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output.startsWith(now.getUTCFullYear()));
    });

    test("interpolates :pagedomain:", () => {
      const input = new Path.Path("a/b/:pagedomain:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("a/b/www.example.com");
    });

    test("interpolates :sourcedomain:", () => {
      const input = new Path.Path("a/b/:sourcedomain:/c");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("a/b/www.source.com/c");
    });

    test("interpolates multiple :sourcedomain:s", () => {
      const input = new Path.Path("a/b/:sourcedomain::sourcedomain:/c");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("a/b/www.source.comwww.source.com/c");
    });

    test("interpolates multiple :sourceurl:", () => {
      const input = new Path.Path("a/b/:sourceurl::sourceurl:/c");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("a/b/http___srcurl.comhttp___srcurl.com/c");
    });

    test("interpolates :pageurl:", () => {
      const input = new Path.Path("a/b/:pageurl:/c");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("a/b/http___www.example.com_foobar_/c");
    });

    test("interpolates :year:", () => {
      const now = new Date();
      const input = new Path.Path(":year:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output.startsWith(now.getFullYear()));
    });

    test("interpolates :month:", () => {
      const now = new Date();
      const input = new Path.Path(":month:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output.startsWith(now.getMonth() + 1));
    });

    test("interpolates :day:", () => {
      const now = new Date();
      const input = new Path.Path(":day:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output.startsWith(now.getDay()));
    });

    test("interpolates :hour:", () => {
      const now = new Date();
      const input = new Path.Path(":hour:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output.startsWith(now.getDay()));
    });

    test("interpolates :minute:", () => {
      const now = new Date();
      const input = new Path.Path(":minute");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output.startsWith(now.getMinutes()));
    });

    test("interpolates :selectiontext:", () => {
      const input = new Path.Path(":selectiontext:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("selectionfoobar");
    });

    test("interpolates :filename:", () => {
      const input = new Path.Path(":filename::filename:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("lol.jpeglol.jpeg");
    });

    test("interpolates :fileext:", () => {
      const input = new Path.Path(":fileext:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("jpeg");
    });

    test("interpolates :linktext:", () => {
      const input = new Path.Path(":linktext:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("linkfoobar");
    });

    test("interpolates :pagetitle:", () => {
      const input = new Path.Path(":pagetitle:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("foobartitle");
    });
  });

  describe("remaining variables and edge cases", () => {
    test("withUrl returns the input for invalid URLs", () => {
      expect(Variable.withUrl("not a url", (url) => url.hostname)).toBe("not a url");
    });

    test("interpolates :minute: and :second:", () => {
      const input = new Path.Path(":minute:/:second:");
      const output = Variable.applyVariables(input, info).finalize();
      const expected = [
        Variable.padDateComponent(info.now.getMinutes()),
        Variable.padDateComponent(info.now.getSeconds()),
      ].join("/");
      expect(output).toBe(expected);
    });

    test("interpolates :pagetitle: as empty without a tab", () => {
      const input = new Path.Path(":pagetitle:");
      const output = Variable.applyVariables(input, { ...info, currentTab: undefined }).finalize();
      expect(output).toBe("_");
    });

    test("interpolates :selectiontext: as empty when nothing is selected", () => {
      const input = new Path.Path(":selectiontext:");
      const output = Variable.applyVariables(input, {
        ...info,
        selectionText: undefined,
      }).finalize();
      expect(output).toBe("_");
    });

    test("trims :selectiontext:", () => {
      const input = new Path.Path(":selectiontext:");
      const output = Variable.applyVariables(input, {
        ...info,
        selectionText: "  padded  ",
      }).finalize();
      expect(output).toBe("padded");
    });

    test("interpolates :naivefilename:", () => {
      const input = new Path.Path(":naivefilename:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("file.jpg");
    });

    test("interpolates :naivefileext:", () => {
      const input = new Path.Path(":naivefileext:");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("jpg");
    });

    test("interpolates :fileext: as empty for extensionless filenames", () => {
      const input = new Path.Path(":fileext:");
      const output = Variable.applyVariables(input, { ...info, filename: "noext" }).finalize();
      expect(output).toBe("_");
    });

    test("passes through variable tokens without a transformer", () => {
      // "---" (the menu separator) parses as a variable but has no transformer
      const input = new Path.Path("---");
      const output = Variable.applyVariables(input, info).finalize();
      expect(output).toBe("---");
    });

    test("leaves paths without a parsed buffer alone", () => {
      const result = Variable.applyVariables({ buf: undefined }, info);
      expect(result.buf).toBeUndefined();
    });
  });
});
