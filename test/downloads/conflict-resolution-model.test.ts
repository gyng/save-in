import {
  isFirefoxUniqueRename,
  splitFirefoxBaseName,
} from "../../src/downloads/conflict-resolution-model.ts";

// Every renamed form below is what Firefox 140 and 158 actually produced for a
// pre-existing file (uniquify, measured through downloads.download).
test.each([
  ["plain.bin", ["plain", ".bin"]],
  ["noext", ["noext", ""]],
  ["a.tar.gz", ["a", ".tar.gz"]],
  ["archive.TAR.BZ2", ["archive", ".TAR.BZ2"]],
  ["multi.dot.name.jpg", ["multi.dot.name", ".jpg"]],
  ["already(1).png", ["already(1)", ".png"]],
  [".hidden", ["", ".hidden"]],
  ["trailing.", ["trailing", "."]],
  ["ünï ç😀.txt", ["ünï ç😀", ".txt"]],
  // Four letters before .gz is not a double extension.
  ["x.json.gz", ["x.json", ".gz"]],
])("splits %s like Firefox", (leaf, parts) => {
  expect(splitFirefoxBaseName(leaf)).toEqual(parts);
});

const ROOT = "/home/me/Downloads";

test.each([
  ["e2e/plain.bin", `${ROOT}/e2e/plain(1).bin`],
  ["e2e/noext", `${ROOT}/e2e/noext(1)`],
  ["e2e/a.tar.gz", `${ROOT}/e2e/a(1).tar.gz`],
  ["e2e/multi.dot.name.jpg", `${ROOT}/e2e/multi.dot.name(1).jpg`],
  // Firefox appends rather than increments.
  ["e2e/already(1).png", `${ROOT}/e2e/already(1)(1).png`],
  ["e2e/already (1).png", `${ROOT}/e2e/already (1)(1).png`],
  ["e2e/ünï ç😀.txt", `${ROOT}/e2e/ünï ç😀(1).txt`],
  ["e2e/.hidden", `${ROOT}/e2e/(1).hidden`],
  ["photo.jpg", `${ROOT}/photo(12).jpg`],
  ["./photo.jpg", `${ROOT}/photo(2).jpg`],
  // Windows reports backslashes and folds directory case.
  ["Pics/photo.jpg", "C:\\Users\\me\\Downloads\\pics\\photo(1).jpg"],
])("%s renamed to %s is a conflict", (requested, actual) => {
  expect(isFirefoxUniqueRename(requested, actual)).toBe(true);
});

test.each([
  ["unchanged name", "e2e/plain.bin", `${ROOT}/e2e/plain.bin`],
  ["a requested (1) name kept as is", "e2e/already(1).png", `${ROOT}/e2e/already(1).png`],
  ["Chrome's spaced suffix", "e2e/plain.bin", `${ROOT}/e2e/plain (1).bin`],
  ["a zero counter", "e2e/plain.bin", `${ROOT}/e2e/plain(0).bin`],
  ["a leading-zero counter", "e2e/plain.bin", `${ROOT}/e2e/plain(01).bin`],
  ["an empty counter", "e2e/plain.bin", `${ROOT}/e2e/plain().bin`],
  ["a non-numeric suffix", "e2e/plain.bin", `${ROOT}/e2e/plain(a).bin`],
  ["a suffix after the extension", "e2e/plain.bin", `${ROOT}/e2e/plain.bin(1)`],
  ["a sanitized name", "e2e/a:b.bin", `${ROOT}/e2e/a_b(1).bin`],
  ["a truncated name", "e2e/very-long-name.bin", `${ROOT}/e2e/very-long-n(1).bin`],
  ["a changed extension", "e2e/plain.bin", `${ROOT}/e2e/plain(1).txt`],
  ["a different directory", "e2e/plain.bin", `${ROOT}/other/plain(1).bin`],
  ["a directory prefix lookalike", "e2e/plain.bin", `${ROOT}/xe2e/plain(1).bin`],
  ["a directory deeper than reported", "a/b/c/plain.bin", "/c/plain(1).bin"],
  ["POSIX directory case", "Pics/photo.jpg", `${ROOT}/pics/photo(1).jpg`],
  ["no filename yet", "e2e/plain.bin", ""],
  ["no requested name", "", `${ROOT}/plain(1).bin`],
])("%s is not a conflict", (_label, requested, actual) => {
  expect(isFirefoxUniqueRename(requested, actual)).toBe(false);
});
