const makeInfoMatcherFactory = propertyName => regex => info => {
  const match = info[propertyName] && info[propertyName].match(regex);

  if (window.SI_DEBUG && match) {
    console.log("matched", match, regex, info); // eslint-disable-line
  }

  return match;
};

const makeTabMatcherFactory = propertyName => regex => info => {
  const match =
    currentTab &&
    currentTab[propertyName] &&
    currentTab[propertyName].match(regex);

  if (window.SI_DEBUG && match) {
    console.log("matched", match, regex, info); // eslint-disable-line
  }

  return match;
};

const makeHostnameMatcherFactory = propertyName => regex => info => {
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
};

const matcherFunctions = {
  fileext: regex => info => {
    const url = info.srcUrl || info.linkUrl || info.pageUrl;
    if (!url) return false;

    const extension = url.match(EXTENSION_REGEX);
    if (!extension) return false;

    const match = extension[1].match(regex);

    if (window.SI_DEBUG && match) {
      console.log("matched", match, regex, info); // eslint-disable-line
    }

    return match;
  },
  filename: regex => (info, filename) => {
    const fn = filename || (info && info.filename);
    if (!fn) return false;

    const match = fn.match(regex);

    if (window.SI_DEBUG && match) {
      console.log("matched", match, regex, info); // eslint-disable-line
    }

    return match;
  },
  frameurl: makeInfoMatcherFactory("frameUrl"),
  linktext: makeInfoMatcherFactory("linkText"),
  mediatype: makeInfoMatcherFactory("mediaType"),
  naivefilename: regex => info => {
    const url = info.srcUrl || info.linkUrl || info.pageUrl;
    if (!url) return false;

    const filename = getFilenameFromUrl(url);
    if (!filename) return false;

    const match = filename.match(regex);

    if (window.SI_DEBUG && match) {
      console.log("matched", match, regex, info); // eslint-disable-line
    }

    return match;
  },
  pagedomain: makeHostnameMatcherFactory("pageUrl"),
  sourcedomain: makeHostnameMatcherFactory("srcUrl"),
  pagetitle: makeTabMatcherFactory("title"),
  pageurl: makeInfoMatcherFactory("pageUrl"),
  selectiontext: makeInfoMatcherFactory("selectionText"),
  sourceurl: makeInfoMatcherFactory("srcUrl")
};

const tokenizeLines = lines =>
  lines
    .split("\n")
    .map(l => ({ l, matches: l.match(/^(\S*): ?(.*)/) }))
    .map(toks => {
      if (!toks.matches || toks.matches.length < 3) {
        window.optionErrors.filenamePatterns.push({
          message: "Bad clause",
          error: `${toks.l || "invalid line syntax"}`
        });
        return null;
      }
      return toks.matches;
    })
    .filter(toks => toks && toks.length >= 3);

const parseRule = lines => {
  const matchers = lines.map(tokens => {
    const name = tokens[1];

    let value;
    try {
      value =
        name === "into" || name === "capture"
          ? tokens[2]
          : new RegExp(tokens[2]);
    } catch (e) {
      window.optionErrors.filenamePatterns.push({
        message: "Invalid rule regex",
        error: `${e}`
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
      const matcher = matcherFunctions[name.toLowerCase()];

      if (!matcher) {
        window.optionErrors.filenamePatterns.push({
          message: "Unknown matcher",
          error: `${name}:`
        });

        return false;
      }

      return {
        name,
        value,
        type,
        matcher: matcher(value)
      };
    } else {
      return {
        name,
        value,
        type
      };
    }
  });

  if (!matchers.some(m => m.type === RULE_TYPES.DESTINATION)) {
    window.optionErrors.filenamePatterns.push({
      message: "Missing clause: into",
      error: name
    });

    return false;
  }

  if (!matchers.some(m => m.type === RULE_TYPES.MATCHER)) {
    window.optionErrors.filenamePatterns.push({
      message: "Rule needs at least one matcher clause",
      error: JSON.stringify(lines.map(l => l[0]))
    });

    return false;
  }

  const intoMatcher = matchers.filter(m => m.name === "into");
  if (intoMatcher.length >= 2) {
    window.optionErrors.filenamePatterns.push({
      message: "Rule can only have one into clause",
      error: JSON.stringify(lines.map(l => l[0]))
    });

    return false;
  }

  if (matchers.filter(m => m.name === "capture").length >= 2) {
    window.optionErrors.filenamePatterns.push({
      message: "Rule can only have one capture clause",
      error: JSON.stringify(lines.map(l => l[0]))
    });

    return false;
  }

  // Capture clause pointing at nothing
  const captures = matchers.filter(m => m.name === "capture");
  if (
    captures &&
    captures.length === 1 &&
    matchers.filter(m => m.name === captures[0].value).length < 1
  ) {
    window.optionErrors.filenamePatterns.push({
      message: "Capture clause is not targeting a matcher",
      error: `capture: ${captures[0].value}`
    });

    return false;
  }

  return matchers;
};

const parseRules = raw => {
  const withoutComments = raw
    .split("\n")
    .filter(l => !l.startsWith("//"))
    .join("\n")
    .trim();

  if (!withoutComments) {
    return [];
  }

  const rules = withoutComments
    .replace(new RegExp("\\n\\n+", "g"), "\n\n")
    .split("\n\n")
    .map(tokenizeLines)
    .map(parseRule)
    .filter(r => !!r);

  if (window.SI_DEBUG) {
    console.log("parsedRules", rules); // eslint-disable-line
  }

  return rules;
};

const matchRule = (rule, info, rest) => {
  const matches = rule
    .filter(m => m.type === RULE_TYPES.MATCHER)
    .map(m => m.matcher(info, rest));

  if (matches.some(m => !m)) {
    return false;
  }

  let destination = rule.find(r => r.name === "into").value;

  // Regex capture groups
  const captureDeclaration = rule.find(
    d => d.type === RULE_TYPES.CAPTURE && d.name === "capture"
  );
  if (captureDeclaration) {
    const captured = rule.find(
      m => m.type === RULE_TYPES.MATCHER && m.name === captureDeclaration.value
    );

    if (!captured || !captured.matcher) {
      createExtensionNotification(
        "Save In: Rule missing capture target",
        JSON.stringify(captureDeclaration)
      );
    } else {
      const capturedMatches = captured.matcher(info, rest);

      for (let i = 0; i < capturedMatches.length; i += 1) {
        destination = destination.split(`:$${i}:`).join(capturedMatches[i]);
      }
    }
  }

  return destination;
};

const matchRules = (rules, info, rest) => {
  for (let i = 0; i < rules.length; i += 1) {
    const result = matchRule(rules[i], info, rest);
    if (result) {
      return result;
    }
  }

  return null;
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    matchRules,
    parseRules,
    makeInfoMatcherFactory,
    matcherFunctions
  };
}
