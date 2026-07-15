// @vitest-environment jsdom

import { matcherDescription, matcherTestValue } from "../../src/options/matcher-descriptions.ts";

beforeEach(() => {
  document.body.innerHTML = `
    <input id="route-debugger-filename" value="archive.tar.gz">
    <input id="route-debugger-source-url" value="https://cdn.example.com/files/photo.jpg">
    <input id="route-debugger-page-url" value="https://news.example.com/reports">
    <input id="route-debugger-mime" value="Image/JPEG; charset=utf-8">
    <select id="route-debugger-context"><option value="MEDIA" selected>Media</option></select>
    <input id="route-debugger-page-title" value="Quarterly report">
    <input id="route-debugger-referrer-url">
    <input id="route-debugger-frame-url" value="https://frame.example/embed">
    <input id="route-debugger-link-text" value="Download report">
    <input id="route-debugger-selection-text" value="Selected copy">
    <select id="route-debugger-media-type"><option value="image" selected>Image</option></select>
    <select id="route-debugger-source-kind"><option value="image" selected>Image</option></select>
    <input id="route-debugger-menu-index" value="documents">
    <input id="route-debugger-comment" value="work files">
    <section id="options-reference-clauses">
      <table><tbody><tr>
        <td><code>filename:</code></td><td>example.jpg</td>
        <td>Localized resolved filename help</td>
      </tr></tbody></table>
    </section>
  `;
});

test("describes matcher help and falls back for custom matchers", () => {
  expect(matcherDescription("filename")).toBe("Localized resolved filename help");
  expect(matcherDescription("custom")).toBe("Translated<referenceRuntimeRuleMatcher>");
});

test.each([
  ["context", "media"],
  ["menuindex", "documents"],
  ["comment", "work files"],
  ["linktext", "Download report"],
  ["selectiontext", "Selected copy"],
  ["referrerurl", "https://news.example.com/reports"],
  ["referrerdomain", "news.example.com"],
  ["pageurl", "https://news.example.com/reports"],
  ["pagedomain", "news.example.com"],
  ["pagerootdomain", "example.com"],
  ["pagetitle", "Quarterly report"],
  ["frameurl", "https://frame.example/embed"],
  ["sourceurl", "https://cdn.example.com/files/photo.jpg"],
  ["sourcedomain", "cdn.example.com"],
  ["sourcerootdomain", "example.com"],
  ["sourcekind", "image"],
  ["filename", "archive.tar.gz"],
  ["naivefilename", "photo.jpg"],
  ["fileext", "jpg"],
  ["urlfileext", "jpg"],
  ["actualfileext", "gz"],
  ["mediatype", "image"],
  ["mime", "image/jpeg"],
  ["contenttype", "image/jpeg"],
  ["custom", ""],
])("shows the current test value for %s", (matcher, expected) => {
  expect(matcherTestValue(matcher)).toBe(expected);
});

test("omits derived previews when test URLs are invalid", () => {
  document.querySelector<HTMLInputElement>("#route-debugger-source-url")!.value = "not a URL";
  expect(matcherTestValue("sourcedomain")).toBe("");
  expect(matcherTestValue("sourcerootdomain")).toBe("");
});

test("omits filename and extension previews when their inputs do not provide them", () => {
  const source = document.querySelector<HTMLInputElement>("#route-debugger-source-url")!;
  const filename = document.querySelector<HTMLInputElement>("#route-debugger-filename")!;
  source.value = "";
  expect(matcherTestValue("naivefilename")).toBe("");
  expect(matcherTestValue("urlfileext")).toBe("");

  source.value = "https://example.com/download";
  filename.value = "README";
  expect(matcherTestValue("fileext")).toBe("");
  expect(matcherTestValue("urlfileext")).toBe("");
  expect(matcherTestValue("actualfileext")).toBe("");
});
