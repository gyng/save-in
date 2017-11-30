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
  pagetitle: makeTabMatcherFactory("title"),
  pageurl: makeInfoMatcherFactory("pageUrl"),
  selectiontext: makeInfoMatcherFactory("selectionText"),
  srcurl: makeInfoMatcherFactory("srcUrl")
};

const tokenizeLine = line =>
  line
    .split("\n")
    .map(l => l.match(/^(\S*): ?(.*)/))
    .map(toks => {
      if (!toks || toks.length < 3) {
        createExtensionNotification("Save In: Bad rule clause", toks, true);
        return null;
      }
      return toks;
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
      createExtensionNotification("Save In: Invalid rule regex", e, true);
    }

    let type = RULE_TYPES.MATCHER;

    // Special matchers
    if (name === "into") {
      type = RULE_TYPES.DESTINATION;
    } else if (name === "capture") {
      type = RULE_TYPES.CAPTURE;
    }

    if (type === RULE_TYPES.MATCHER) {
      const matcher = matcherFunctions[name.toLowerCase()];

      if (!matcher) {
        createExtensionNotification(
          "Save In: Unknown matcher clause",
          name,
          true
        );
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

  if (
    !matchers.some(m => m.type === RULE_TYPES.DESTINATION) ||
    !matchers.some(m => m.type === RULE_TYPES.MATCHER)
  ) {
    createExtensionNotification(
      "Save In: Rule missing output or matcher",
      JSON.stringify(lines.map(l => l[0]))
    );

    return false;
  }

  return matchers;
};

const parseRules = raw => {
  const rules = raw
    .split("\n\n")
    .map(tokenizeLine)
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

    if (!captured) {
      createExtensionNotification(
        "Save In: Rule missing capture target",
        JSON.stringify(captureDeclaration)
      );
    }

    const capturedMatches = captured.matcher(info);

    for (let i = 0; i < capturedMatches.length; i += 1) {
      destination = destination.split(`:$${i}:`).join(capturedMatches[i]);
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
    parseRules
  };
}
