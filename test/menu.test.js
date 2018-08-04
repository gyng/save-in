const menu = require("../src/menu.js");

test("parses comments for metadata", () => {
  const input = "(alias: doggo is (cute!)) cats (foo:bar)";
  const actual = menu.parseMeta(input);

  const expected = {
    alias: "doggo is (cute!)",
    foo: "bar"
  };
  expect(actual).toEqual(expected);
});
