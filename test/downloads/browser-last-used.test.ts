import {
  deriveDownloadsRoot,
  relativeDirectoryWithinRoot,
} from "../../src/downloads/browser-last-used.ts";

describe("browser Save As locations", () => {
  test.each([
    ["/home/user/Downloads/Images/picture (1).png", "Images/picture.png", "/home/user/Downloads/"],
    ["C:\\Users\\User\\Downloads\\Work\\file.txt", "Work/file.txt", "C:\\Users\\User\\Downloads\\"],
    ["/home/user/Downloads/file.txt", "file.txt", "/home/user/Downloads/"],
    ["/file.txt", "file.txt", "/"],
    [
      "\\\\server\\share\\Downloads\\Work\\file.txt",
      "Work/file.txt",
      "\\\\server\\share\\Downloads\\",
    ],
  ])("derives the Downloads root from a Save In result", (absolute, requested, expected) => {
    expect(deriveDownloadsRoot(absolute, requested)).toBe(expected);
  });

  test("refuses a result whose intended directory does not match", () => {
    expect(deriveDownloadsRoot("/tmp/Other/file.txt", "Expected/file.txt")).toBeNull();
  });

  test("refuses an intended directory deeper than the absolute result", () => {
    expect(deriveDownloadsRoot("/tmp/file.txt", "one/two/file.txt")).toBeNull();
  });

  test.each([
    ["/home/user/Downloads/file.txt", "/home/user/Downloads/", "."],
    ["/home/user/Downloads/Work/file.txt", "/home/user/Downloads/", "Work"],
    ["C:\\Users\\User\\Downloads\\Work\\file.txt", "C:\\Users\\User\\Downloads\\", "Work"],
  ])("returns a relative folder inside Downloads", (absolute, root, expected) => {
    expect(relativeDirectoryWithinRoot(absolute, root)).toBe(expected);
  });

  test("refuses sibling folders with a shared prefix", () => {
    expect(
      relativeDirectoryWithinRoot("/home/user/Downloads-old/file.txt", "/home/user/Downloads/"),
    ).toBeNull();
  });

  test("refuses a root deeper than the selected folder", () => {
    expect(relativeDirectoryWithinRoot("/tmp/file.txt", "/tmp/one/two/")).toBeNull();
  });
});
