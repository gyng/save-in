const withUrl = (str, cb) => {
  try {
    return cb(new URL(str));
  } catch (e) {
    return str;
  }
};

const PS = PATH_SEGMENT;

const padDateComponent = (num, func) => num.toString().padStart(2, "0");
const toDateString = d =>
  [
    d.getFullYear(),
    padDateComponent(d.getMonth() + 1),
    padDateComponent(d.getDate())
  ].join("-");
const toISODateString = d =>
  [
    d.getUTCFullYear(),
    padDateComponent(d.getUTCMonth() + 1),
    padDateComponent(d.getUTCDate()),
    "T",
    padDateComponent(d.getUTCHours()),
    padDateComponent(d.getUTCMinutes()),
    padDateComponent(d.getUTCSeconds()),
    "Z"
  ].join("");

// Token, index, tokens, extra info
const variableTransformers = {
  [SDN.FILENAME]: opts => PS.STRING(opts.filename),
  [SDN.SOURCE_DOMAIN]: opts =>
    PS.STRING(withUrl(opts.url, url => url.hostname)),
  [SDN.PAGE_DOMAIN]: opts =>
    PS.STRING(withUrl(opts.pageUrl, url => url.hostname)),
  [SDN.PAGE_URL]: opts => PS.STRING(opts.pageUrl),
  [SDN.SOURCE_URL]: opts => PS.STRING(opts.sourceUrl),
  [SDN.DATE]: opts => PS.STRING(toDateString(opts.now)),
  [SDN.ISO8601_DATE]: opts => PS.STRING(toISODateString(opts.now)),
  [SDN.UNIX_DATE]: opts => PS.STRING(Date.parse(opts.now) / 1000),
  [SDN.YEAR]: opts => PS.STRING(opts.now.getFullYear()),
  [SDN.MONTH]: opts => PS.STRING(padDateComponent(opts.now.getMonth() + 1)),
  [SDN.DAY]: opts => PS.STRING(padDateComponent(opts.now.getDate())),
  [SDN.HOUR]: opts => PS.STRING(padDateComponent(opts.now.getHours())),
  [SDN.MINUTE]: opts => PS.STRING(padDateComponent(opts.now.getMinutes())),
  [SDN.SECOND]: opts => PS.STRING(padDateComponent(opts.now.getSeconds())),
  [SDN.PAGE_TITLE]: opts =>
    PS.STRING((opts.currentTab && opts.currentTab.title) || ""),
  [SDN.LINK_TEXT]: opts => PS.STRING(opts.linkText),
  [SDN.SELECTION_TEXT]: opts =>
    PS.STRING((opts.selectionText && opts.selectionText.trim()) || ""),
  [SDN.NAIVE_FILENAME]: opts => {
    const naiveFilename = getFilenameFromUrl(opts.url);
    return PS.STRING(naiveFilename);
  },
  [SDN.NAIVE_FILE_EXTENSION]: opts => {
    const naiveFilename = getFilenameFromUrl(opts.url);
    const fileExtensionMatches = naiveFilename.match(EXTENSION_REGEX);
    const fileExtension =
      (fileExtensionMatches && fileExtensionMatches[1]) || "";
    return PS.STRING(fileExtension);
  }
};

const applyVariables = (path, opts = {}) =>
  Object.assign(path, {
    buf:
      path.buf &&
      path.buf.map((t, i, arr) => {
        if (t.type === PATH_SEGMENT_TYPES.VARIABLE) {
          const transformer = variableTransformers[t];
          if (transformer) {
            return transformer(opts, t, i, arr);
          }
        }

        return t;
      })
  });
