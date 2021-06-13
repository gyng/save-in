const constants = require("../src/constants.js");

Object.assign(global, constants);
const router = require("../src/router.js");
const Variable = require("../src/variable.js");
const Path = require("../src/path.js");

global.Path = Path;
global.Download = require("../src/download.js");

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
});
