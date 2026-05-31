import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHtmlExportPayload,
  suggestedExportName,
  type ExportSource,
} from "./export_document.ts";

function source(overrides: Partial<ExportSource> = {}): ExportSource {
  return {
    bodyHtml: "<h1>Title</h1><p>Body</p>",
    themeCss: ":root { --pmd-bg: #fff; }",
    title: "My Doc",
    docPath: "/home/u/notes/my-doc.md",
    ...overrides,
  };
}

test("buildHtmlExportPayload forwards the sanitized body and theme CSS verbatim", () => {
  const payload = buildHtmlExportPayload(source());
  assert.equal(payload.body_html, "<h1>Title</h1><p>Body</p>");
  assert.equal(payload.theme_css, ":root { --pmd-bg: #fff; }");
  assert.equal(payload.title, "My Doc");
});

test("buildHtmlExportPayload defaults a blank title to the filename stem", () => {
  const payload = buildHtmlExportPayload(source({ title: "" }));
  assert.equal(payload.title, "my-doc");
});

test("buildHtmlExportPayload falls back to a generic title when nothing is known", () => {
  const payload = buildHtmlExportPayload(source({ title: "", docPath: null }));
  assert.equal(payload.title, "Untitled");
});

test("suggestedExportName replaces a markdown extension with .html", () => {
  assert.equal(suggestedExportName("/home/u/notes/my-doc.md"), "my-doc.html");
  assert.equal(suggestedExportName("/x/Report.MARKDOWN"), "Report.html");
});

test("suggestedExportName handles an extension-less or missing path", () => {
  assert.equal(suggestedExportName("/x/readme"), "readme.html");
  assert.equal(suggestedExportName(null), "document.html");
  assert.equal(suggestedExportName(""), "document.html");
});
