import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImageMarkdown,
  classifyDroppedFile,
  clipboardImageName,
  isImageFileName,
  isImageMime,
} from "./image_embed.ts";

test("isImageMime recognises image/* and rejects others", () => {
  assert.equal(isImageMime("image/png"), true);
  assert.equal(isImageMime("IMAGE/JPEG"), true);
  assert.equal(isImageMime("image/svg+xml"), false);
  assert.equal(isImageMime("text/markdown"), false);
  assert.equal(isImageMime(""), false);
  assert.equal(isImageMime(null), false);
});

test("isImageFileName checks extensions case-insensitively", () => {
  assert.equal(isImageFileName("a.PNG"), true);
  assert.equal(isImageFileName("photo.jpeg"), true);
  assert.equal(isImageFileName("vector.svg"), false);
  assert.equal(isImageFileName("doc.md"), false);
  assert.equal(isImageFileName("noext"), false);
});

test("classifyDroppedFile distinguishes embed / open / ignore", () => {
  assert.equal(classifyDroppedFile("pic.png", "image/png"), "embed");
  // Extension wins even when MIME is empty (drop gives no type sometimes).
  assert.equal(classifyDroppedFile("pic.gif", ""), "embed");
  assert.equal(classifyDroppedFile("vector.svg", "image/svg+xml"), "ignore");
  assert.equal(classifyDroppedFile("notes.md", "text/markdown"), "open");
  assert.equal(classifyDroppedFile("notes.markdown", ""), "open");
  assert.equal(classifyDroppedFile("page.html", "text/html"), "open");
  assert.equal(classifyDroppedFile("page.HTM", ""), "open");
  assert.equal(classifyDroppedFile("archive.zip", "application/zip"), "ignore");
});

test("clipboardImageName synthesises pasted-<n>.<ext> from MIME", () => {
  assert.equal(clipboardImageName("image/png", 1), "pasted-1.png");
  assert.equal(clipboardImageName("image/jpeg", 2), "pasted-2.jpg");
  assert.equal(clipboardImageName("image/webp", 3), "pasted-3.webp");
  // Unknown image MIME falls back to png.
  assert.equal(clipboardImageName("image/heic", 4), "pasted-4.png");
});

test("buildImageMarkdown produces a relative image link", () => {
  assert.equal(
    buildImageMarkdown("images/Notes/x.png"),
    "![](images/Notes/x.png)"
  );
  assert.equal(
    buildImageMarkdown("images/Notes/x.png", "diagram"),
    "![diagram](images/Notes/x.png)"
  );
});
