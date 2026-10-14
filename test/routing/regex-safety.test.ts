import { isSafeRoutingRegex } from "../../src/routing/regex-safety.ts";

test.each([
  /^https?:\/\//,
  /(?:jpg|png)$/i,
  /(?:ab)+/,
  /(?:[^/]+\/)+/,
  /(?:\d+\/)+/,
  /(?:\w+-)+/,
  /(?:\s+_)+/,
  /[a-z]+/,
  /a{1,3}/,
  /(ab){1}/,
])("accepts bounded or delimiter-safe regexes %#", (regex) => {
  expect(isSafeRoutingRegex(regex)).toBe(true);
});

test.each([
  /(a+)+$/,
  /(a*){2,}/,
  /(a+){2}/,
  /(a+){1,3}/,
  /(a|aa)+$/,
  /(a+a)+$/,
  /(.+\/)+$/,
  /(?:[^/]+x)+$/,
  /(?:\d+1)+$/,
  /(?:\w+_)+$/,
  /(?:\s+ )+$/,
  /(?:[^/]+\d)+$/,
  /^(a+)\1$/,
  /^(?<part>a+)\k<part>$/,
])("rejects ambiguous repetition and backreferences %#", (regex) => {
  expect(isSafeRoutingRegex(regex)).toBe(false);
});

test("rejects oversized expressions while ignoring literal non-regex values", () => {
  expect(isSafeRoutingRegex("css selector")).toBe(true);
  expect(isSafeRoutingRegex(new RegExp("a".repeat(1_025)))).toBe(false);
});

// Each unbounded wildcard that can keep consuming where the previous one could
// adds a polynomial degree, and an unanchored search adds one more. Degree two
// is bounded by the matched-input cap; degree three is not.
test.each([
  /.*\.(jpg|png)$/,
  /^.*\/.*\.jpg$/,
  /[^/]*\/[^/]*\.jpg/,
  /[^\]]*\][^\]]*x/,
  /https?:\/\/.*\/.*\.jpg/,
  /^https?:\/\/[^/]+\/.*\.jpg$/,
  /\S+ \S+x/,
  /\D+1\D+x/,
  /\W+a\W+x/,
  /.*\n.*x/,
  /[^]*x/,
  /\.jpg$/,
  /a{2,}b{3}/,
  /x{/,
  /\u0041.*\x41.*/,
  /^\p{L}.*b.*/u,
  /\u{41}.*\cJ.*/u,
  /^(?:jpg|.*)$/,
  /.*/,
  /a|.*/,
])("accepts wildcards whose backtracking stays bounded %#", (regex) => {
  expect(isSafeRoutingRegex(regex)).toBe(true);
});

test.each([
  /.*\/.*\.jpg/,
  /.*.*\.jpg/,
  /[^?]*\/[^?]*\.jpg/,
  /(.*)\/(.*)\.jpg/,
  /.*(x|y).*z/,
  /.*(?:\/)?.*z/,
  /.*\/*.*z/,
  /\S+\S+x/,
  /.+?a.{2,}b/,
  /^.*\/.*\/.*\.jpg$/,
  /.*[^/]*\/.*x/,
  /x|.*.*/,
  /.*\..*/s,
  /\p{L}.*b.*/u,
])("rejects compounding unbounded wildcards %#", (regex) => {
  expect(isSafeRoutingRegex(regex)).toBe(false);
});
