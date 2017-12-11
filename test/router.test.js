const router = require("../src/router.js");
const downloads = require("../src/download.js");
const constants = require("../src/constants.js");

describe("filename rewrite and routing", () => {
  const info = {
    srcUrl: "http://source.com/cat.jpg",
    linkUrl: "http://link.com",
    pageUrl: "http://page.com",
    frameUrl: "http://frameurl.com",
    linkText: "link text"
  };

  beforeAll(() => {
    global.createExtensionNotification = () => {};
    global.optionErrors = {
      filenamePatterns: [],
      paths: []
    };
    global.currentTab = {
      title: "some title"
    };
    global.browser = { i18n: { getMessage: () => {} } };
    global.getFilenameFromUrl = downloads.getFilenameFromUrl;
    global.sanitizePath = downloads.sanitizePath;
    global.removeSpecialDirs = downloads.removeSpecialDirs;
    global.RULE_TYPES = constants.RULE_TYPES;
    global.SPECIAL_DIRS = constants.SPECIAL_DIRS;
    global.EXTENSION_REGEX = downloads.EXTENSION_REGEX;
  });

  afterAll(() => {
    global.createExtensionNotification = undefined;
    global.currentTab = undefined;
  });

  describe("matcher functions", () => {
    test("fileext", () => {
      const matcher = router.matcherFunctions.fileext(new RegExp("jpg"));
      expect(matcher(info).length).toBe(1);
      expect(matcher(info)[0]).toBe("jpg");
    });

    test("fileext negative", () => {
      const matcher = router.matcherFunctions.fileext(new RegExp("foobar"));
      expect(matcher(info)).toBe(null);
    });

    test("filename", () => {
      const matcher = router.matcherFunctions.filename(new RegExp("dog.jpg"));
      expect(matcher(info, { filename: "dog.jpg" }).length).toBe(1);
      expect(matcher(info, { filename: "dog.jpg" })[0]).toBe("dog.jpg");
    });

    test("filename negative", () => {
      const matcher = router.matcherFunctions.filename(new RegExp("dog.jpg"));
      expect(matcher(info, { filename: "cat.jpg" })).toBe(null);
    });

    test("naivefilename", () => {
      const matcher = router.matcherFunctions.naivefilename(
        new RegExp("cat.jpg")
      );
      expect(matcher(info).length).toBe(1);
      expect(matcher(info)[0]).toBe("cat.jpg");
    });

    test("naivefilename negative", () => {
      const matcher = router.matcherFunctions.naivefilename(
        new RegExp("dog.jpg")
      );
      expect(matcher(info)).toBe(null);
    });
    test("naivefilename negative", () => {
      const matcher = router.matcherFunctions.naivefilename(
        new RegExp("dog.jpg")
      );
      expect(matcher(info, "cat.jpg")).toBe(null);
    });

    test("infoMatcherFactory matchers", () => {
      const matcher = router.matcherFunctions.frameurl(new RegExp(".*"));
      expect(matcher(info).length).toBe(1);
      expect(matcher(info)[0]).toBe(info.frameUrl);
    });

    test("infoMatcherFactory negative", () => {
      const matcher = router.matcherFunctions.frameurl(new RegExp("notvalid"));
      expect(matcher(info)).toBe(null);
    });

    test("tabMatcherFactory matchers", () => {
      const matcher = router.matcherFunctions.pagetitle(new RegExp(".*"));
      expect(matcher(info).length).toBe(1);
      expect(matcher(info)[0]).toBe(currentTab.title);
    });

    test("tabMatcherFactory negative", () => {
      const matcher = router.matcherFunctions.pagetitle(new RegExp("notvalid"));
      expect(matcher(info)).toBe(null);
    });
  });

  describe("rule parsing", () => {
    test("parsing valid rules", () => {
      const rules = router.parseRules(
        "sourceurl: dog\ninto: cat\n\npageurl:cat\ncapture: pageurl\ninto:dog"
      );
      expect(rules.length).toBe(2);
      expect(rules[0].length).toBe(2);
      expect(rules[0][0].name).toBe("sourceurl");
      expect(rules[0][0].type).toBe(RULE_TYPES.MATCHER);
      expect(rules[0][1].name).toBe("into");
      expect(rules[0][1].type).toBe(RULE_TYPES.DESTINATION);

      expect(rules[1].length).toBe(3);
      expect(rules[1][0].type).toBe(RULE_TYPES.MATCHER);
      expect(rules[1][1].type).toBe(RULE_TYPES.CAPTURE);
      expect(rules[1][1].value).toBe("pageurl");
      expect(rules[1][2].type).toBe(RULE_TYPES.DESTINATION);
    });

    test("parsing missing into", () => {
      const rules = router.parseRules(
        "sourceurl: dog\n\npageurl:cat\ncapture: pageurl\ninto:dog"
      );

      expect(rules.length).toBe(1);
      expect(rules[0].length).toBe(3);
      expect(rules[0][0].name).toBe("pageurl");
    });

    test("parsing missing matcher", () => {
      const rules = router.parseRules(
        "into: dog\n\npageurl:cat\ncapture: pageurl\ninto:dog"
      );

      expect(rules.length).toBe(1);
      expect(rules[0].length).toBe(3);
      expect(rules[0][0].name).toBe("pageurl");
    });

    test("parsing unknown clause", () => {
      const rules = router.parseRules(
        "what: dog\n\npageurl:cat\ncapture: pageurl\ninto:dog"
      );

      expect(rules.length).toBe(1);
      expect(rules[0].length).toBe(3);
      expect(rules[0][0].name).toBe("pageurl");
    });
  });

  describe("rule matching", () => {
    let rules;

    beforeAll(() => {
      global.RULE_TYPES = constants.RULE_TYPES;
      rules = router.parseRules(
        "sourceurl: dog\ninto: cat\n\nsourceurl: (cat)\ncapture: sourceurl\ninto: dog:$1:"
      );
    });

    test("matching valid", () => {
      const match = router.matchRules(rules, info);
      expect(match).toBe("dogcat");
    });

    test("missing capture target", () => {
      rules = router.parseRules(
        "sourceurl: dog\ncapture: pageurl\ninto: cat:$1:"
      );
      const match = router.matchRules(rules, info);
      expect(match).toBe(null);
    });
  });
});
