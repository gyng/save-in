const RouterFactory = {
  makeInfoMatcherFactory:
    (propertyName, alternativePropertyName) => (regex) => (info) => {
      let match = info[propertyName] && info[propertyName].match(regex);

      // Hack for sourceUrl, srcUrl
      if (!match && alternativePropertyName) {
        match =
          info[alternativePropertyName] &&
          info[alternativePropertyName].match(regex);
      }

      if (window.SI_DEBUG && match) {
      console.log("matched", match, regex, info); // eslint-disable-line
      }

      return match;
    },

  makeTabMatcherFactory: (propertyName) => (regex) => (info) => {
    const match =
      currentTab &&
      currentTab[propertyName] &&
      currentTab[propertyName].match(regex);

    if (window.SI_DEBUG && match) {
      console.log("matched", match, regex, info); // eslint-disable-line
    }

    return match;
  },

  makeHostnameMatcherFactory: (propertyName) => (regex) => (info) => {
    try {
      const url = new URL(info && info[propertyName]);

      const hostname = url.hostname;
      const match = hostname.match(regex);

      if (window.SI_DEBUG && match) {
        console.log("matched", match, regex, info); // eslint-disable-line
      }

      return match;
    } catch (e) {
      if (window.SI_DEBUG) {
        console.log("bad page domain in matcher", info.pageUrl, e); // eslint-disable-line
      }

      return null;
    }
  },
};

const Router = {
  matcherFunctions: {
    context:
      (regex) =>
      (info, { context }) => {
        const match = context.toLowerCase().match(regex);

        if (window.SI_DEBUG && match) {
        console.log("matched", match, regex, info); // eslint-disable-line
        }

        return match;
      },
    menuindex:
      (regex) =>
      (info, { menuIndex } = {}) => {
        const match = menuIndex.match(regex);

        if (window.SI_DEBUG && match) {
        console.log("matched", match, regex, info); // eslint-disable-line
        }

        return match;
      },
    comment:
      (regex) =>
      (info, { comment } = {}) => {
        const match = comment.match(regex);

        if (window.SI_DEBUG && match) {
        console.log("matched", match, regex, info); // eslint-disable-line
        }

        return match;
      },
    fileext: (regex) => (info) => {
      const url = info.sourceUrl || info.srcUrl || info.linkUrl || info.pageUrl;
      if (!url) return false;

      const extension = url.match(Download.EXTENSION_REGEX);
      if (!extension) return false;

      const match = extension[1].match(regex);

      if (window.SI_DEBUG && match) {
        console.log("matched", match, regex, info); // eslint-disable-line
      }

      return match;
    },
    filename:
      (regex) =>
      (info, { filename } = {}) => {
        const fn = (info && info.filename) || filename;
        if (!fn) return false;

        const match = fn.match(regex);

        if (window.SI_DEBUG && match) {
        console.log("matched", match, regex, info); // eslint-disable-line
        }

        return match;
      },
    frameurl: RouterFactory.makeInfoMatcherFactory("frameUrl"),
    linktext: RouterFactory.makeInfoMatcherFactory("linkText"),
    mediatype: RouterFactory.makeInfoMatcherFactory("mediaType"),
    naivefilename: (regex) => (info) => {
      const url = info.srcUrl || info.linkUrl || info.pageUrl;
      if (!url) return false;

      const filename = Download.getFilenameFromUrl(url);
      if (!filename) return false;

      const match = filename.match(regex);

      if (window.SI_DEBUG && match) {
        console.log("matched", match, regex, info); // eslint-disable-line
      }

      return match;
    },
    pagedomain: RouterFactory.makeHostnameMatcherFactory("pageUrl"),
    sourcedomain: RouterFactory.makeHostnameMatcherFactory("srcUrl"),
    pagetitle: RouterFactory.makeTabMatcherFactory("title"),
    pageurl: RouterFactory.makeInfoMatcherFactory("pageUrl"),
    selectiontext: RouterFactory.makeInfoMatcherFactory("selectionText"),
    sourceurl: RouterFactory.makeInfoMatcherFactory("sourceUrl", "srcUrl"),
  },

  tokenizeLines: (lines) =>
    lines
      .split("\n")
      .map((l) => ({ l, matches: l.match(/^(\S*): ?(.*)/) }))
      .map((toks) => {
        if (!toks.matches || toks.matches.length < 3) {
          window.optionErrors.filenamePatterns.push({
            message: browser.i18n.getMessage("ruleBadClause"),
            error: `${toks.l || "invalid line syntax"}`,
          });
          return null;
        }

        return toks.matches;
      })
      .filter((toks) => toks && toks.length >= 3),

  parseRule: (lines) => {
    const matchers = lines.map((tokens) => {
      const name = tokens[1];

      let value;
      try {
        value =
          name === "into" || name === "capture"
            ? tokens[2]
            : new RegExp(tokens[2]);
      } catch (e) {
        window.optionErrors.filenamePatterns.push({
          message: browser.i18n.getMessage("ruleInvalidRegex"),
          error: `${e}`,
        });
      }

      let type = RULE_TYPES.MATCHER;

      // Special matchers
      if (name === "into") {
        type = RULE_TYPES.DESTINATION;
        value = value.replace(/^\.\//, "");
      } else if (name === "capture") {
        type = RULE_TYPES.CAPTURE;
      }

      if (type === RULE_TYPES.MATCHER) {
        const matcher = Router.matcherFunctions[name.toLowerCase()];

        if (!matcher) {
          window.optionErrors.filenamePatterns.push({
            message: browser.i18n.getMessage("ruleUnknownMatcher"),
            error: `${name}:`,
          });

          return false;
        }

        return {
          name,
          value,
          type,
          matcher: matcher(value),
        };
      } else {
        return {
          name,
          value,
          type,
        };
      }
    });

    if (!matchers.some((m) => m.type === RULE_TYPES.DESTINATION)) {
      window.optionErrors.filenamePatterns.push({
        message: browser.i18n.getMessage("ruleMissingInto"),
        error: "",
      });

      return false;
    }

    const destination = matchers.find((m) => m.type === RULE_TYPES.DESTINATION);
    if (
      destination.value.match(/:\$\d+:/) &&
      !matchers.find((m) => m.name === "capture")
    ) {
      window.optionErrors.filenamePatterns.push({
        message: browser.i18n.getMessage("ruleMissingCapture"),
        error: destination.value,
        warning: true,
      });
    }

    if (!matchers.some((m) => m.type === RULE_TYPES.MATCHER)) {
      window.optionErrors.filenamePatterns.push({
        message: browser.i18n.getMessage("ruleMissingMatcher"),
        error: JSON.stringify(lines.map((l) => l[0])),
      });

      return false;
    }

    const intoMatcher = matchers.filter((m) => m.name === "into");
    if (intoMatcher.length >= 2) {
      window.optionErrors.filenamePatterns.push({
        message: browser.i18n.getMessage("ruleExtraInto"),
        error: JSON.stringify(lines.map((l) => l[0])),
      });

      return false;
    }

    if (matchers.filter((m) => m.name === "capture").length >= 2) {
      window.optionErrors.filenamePatterns.push({
        message: browser.i18n.getMessage("ruleMultipleCapture"),
        error: JSON.stringify(lines.map((l) => l[0])),
      });

      return false;
    }

    // Capture clause pointing at nothing
    const captures = matchers.filter((m) => m.name === "capture");
    if (
      captures &&
      captures.length === 1 &&
      matchers.filter((m) => m.name === captures[0].value).length < 1
    ) {
      window.optionErrors.filenamePatterns.push({
        message: browser.i18n.getMessage("ruleCaptureMissingMatcher"),
        error: `capture: ${captures[0].value}`,
      });

      return false;
    }

    return matchers;
  },

  parseRules: (raw) => {
    const withoutComments = raw
      .split("\n")
      .filter((l) => !l.startsWith("//"))
      .join("\n")
      .trim();

    if (!withoutComments) {
      return [];
    }

    const rules = withoutComments
      .replace(new RegExp("\\n\\n+", "g"), "\n\n")
      .split("\n\n")
      .map(Router.tokenizeLines)
      .map(Router.parseRule)
      .filter((r) => !!r);

    if (window.SI_DEBUG) {
      console.log("parsedRules", rules); // eslint-disable-line
    }

    return rules;
  },

  getCaptureMatches: (rule, info) => {
    const captureDeclaration = rule.find(
      (d) => d.type === RULE_TYPES.CAPTURE && d.name === "capture"
    );

    if (captureDeclaration) {
      const captured = rule.find(
        (m) =>
          m.type === RULE_TYPES.MATCHER && m.name === captureDeclaration.value
      );

      if (!captured || !captured.matcher) {
        return null;
      }

      return captured.matcher(info);
    } else {
      return null;
    }
  },

  matchRule: (rule, info) => {
    const matches = rule
      .filter((m) => m.type === RULE_TYPES.MATCHER)
      .map((m) => m.matcher(info, info));

    if (matches.some((m) => !m)) {
      return false;
    }

    let destination = rule.find((r) => r.name === "into").value;

    // Regex capture groups
    const capturedMatches = Router.getCaptureMatches(rule, info);

    if (capturedMatches) {
      for (let i = 0; i < capturedMatches.length; i += 1) {
        destination = destination.split(`:$${i}:`).join(capturedMatches[i]);
      }
    }

    return destination;
  },

  matchRules: (rules, info) => {
    for (let i = 0; i < rules.length; i += 1) {
      const result = Router.matchRule(rules[i], info);
      if (result) {
        return result;
      }
    }

    return null;
  },
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Router;
}
