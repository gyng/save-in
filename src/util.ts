// Small shared helpers, consolidated here to kill the copies scattered across
// the background scripts (the standing "// TODO: Move into utils").

export const Util = {
  // Parse `str` as a URL and return `cb(url)`; on a parse failure return
  // `fallback`. Replaces the ad-hoc try/`new URL`/catch guard reimplemented in
  // variable.js, router.js, headers.js and messaging.js (each with a different
  // failure return — hence the explicit `fallback`).
  withUrl: (str, cb, fallback = null) => {
    try {
      return cb(new URL(str));
    } catch (e) {
      return fallback;
    }
  },

  // Split a multi-line textarea value into trimmed, non-empty lines. The
  // paths/referer-filter/prefer-links-filter options all parse user input this
  // way; keeping it in one place stops the per-site predicate drift (and the
  // empty-line-becomes-match-everything bug when the lines are mapped to RegExp).
  splitLines: (raw) =>
    (raw || "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
};
