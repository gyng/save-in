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
  /^(a+)\1$/,
  /^(?<part>a+)\k<part>$/,
])("rejects ambiguous repetition and backreferences %#", (regex) => {
  expect(isSafeRoutingRegex(regex)).toBe(false);
});

test("rejects oversized expressions while ignoring literal non-regex values", () => {
  expect(isSafeRoutingRegex("css selector")).toBe(true);
  expect(isSafeRoutingRegex(new RegExp("a".repeat(1_025)))).toBe(false);
});
