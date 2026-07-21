import test from "node:test";
import assert from "node:assert/strict";
import {
  parentOf,
  isUnder,
  prunedExpanded,
  createWorkspaceModel,
  ensurePathVisible,
  baseName,
  isHiddenName,
} from "./workspace.ts";
import type { DirListing } from "./file_browser.ts";

test("parentOf returns the parent path or null at root", () => {
  assert.equal(parentOf("/a/b/c"), "/a/b");
  assert.equal(parentOf("/a"), "/");
  assert.equal(parentOf("/"), null);
  assert.equal(parentOf("/a/b/"), "/a"); // trailing slash tolerated
});

test("isUnder is a component-wise descendant test", () => {
  assert.equal(isUnder("/base", "/base/x"), true);
  assert.equal(isUnder("/base", "/base"), true);
  assert.equal(isUnder("/base", "/base_evil"), false); // not a string prefix
  assert.equal(isUnder("/base/x", "/base"), false); // ancestor, not descendant
});

test("prunedExpanded keeps only paths under the root", () => {
  const got = prunedExpanded(new Set(["/r/a", "/r/a/b", "/other/x"]), "/r");
  assert.deepEqual([...got].sort(), ["/r/a", "/r/a/b"]);
});

function fakeListing(dir: string, names: string[]): DirListing {
  return {
    dir,
    entries: names.map((n) => ({
      name: n.replace(/\/$/, ""),
      path: `${dir}/${n.replace(/\/$/, "")}`,
      is_dir: n.endsWith("/"),
      is_markdown: n.endsWith(".md"),
    })),
  };
}

test("setRoot stores canonical root, loads it, prunes stale expanded", async () => {
  const calls: string[] = [];
  const model = createWorkspaceModel({
    listDir: async (dir) => {
      calls.push(dir);
      return fakeListing(dir, ["a/", "x.md"]);
    },
  });
  await model.expand("/old/keep"); // not under new root → pruned
  await model.setRoot("/r");
  assert.equal(model.root(), "/r");
  // expand() eagerly lists its dir before setRoot lists the new root.
  assert.deepEqual(calls, ["/old/keep", "/r"]);
  assert.equal(model.expanded().has("/old/keep"), false);
  assert.deepEqual(model.entriesOf("/r")?.map((e) => e.name), ["a", "x.md"]);
});

test("navigateUp moves root to the parent and lists it", async () => {
  const model = createWorkspaceModel({
    listDir: async (dir) => fakeListing(dir, ["child.md"]),
  });
  await model.setRoot("/r/sub");
  const up = await model.navigateUp();
  assert.equal(up, true);
  assert.equal(model.root(), "/r");
});

test("navigateUp at filesystem root is a no-op returning false", async () => {
  const model = createWorkspaceModel({ listDir: async (d) => fakeListing(d, []) });
  await model.setRoot("/");
  assert.equal(await model.navigateUp(), false);
  assert.equal(model.root(), "/");
});

test("select and setActiveFile are independent highlights", () => {
  const model = createWorkspaceModel({ listDir: async (d) => fakeListing(d, []) });
  model.select("/r/a.md");
  model.setActiveFile("/r/b.md");
  assert.equal(model.selected(), "/r/a.md");
  assert.equal(model.activeFile(), "/r/b.md");
});

test("revealFile sets activeFile and selected for a file under the root", async () => {
  const model = createWorkspaceModel({ listDir: async (d) => fakeListing(d, ["a/", "x.md"]) });
  await model.setRoot("/r");
  await model.revealFile("/r/x.md");
  assert.equal(model.activeFile(), "/r/x.md");
  assert.equal(model.selected(), "/r/x.md");
});

test("revealFile expands intermediate folders so the file is reachable", async () => {
  const model = createWorkspaceModel({
    listDir: async (dir) => {
      if (dir === "/r") return fakeListing(dir, ["a/"]);
      if (dir === "/r/a") return fakeListing(dir, ["b/"]);
      if (dir === "/r/a/b") return fakeListing(dir, ["c.md"]);
      return fakeListing(dir, []);
    },
  });
  await model.setRoot("/r");
  await model.revealFile("/r/a/b/c.md");
  assert.equal(model.activeFile(), "/r/a/b/c.md");
  assert.equal(model.selected(), "/r/a/b/c.md");
  assert.equal(model.expanded().has("/r"), true);
  assert.equal(model.expanded().has("/r/a"), true);
  assert.equal(model.expanded().has("/r/a/b"), true);
  assert.deepEqual(model.entriesOf("/r/a/b")?.map((e) => e.name), ["c.md"]);
});

test("revealFile injects hidden (dot) path segments omitted by list_dir", async () => {
  // Backend hides `.agents` when show_hidden_files is false, so list_dir never
  // returns it — yet opening a file under that folder must still expand the tree.
  const model = createWorkspaceModel({
    listDir: async (dir) => {
      if (dir === "/home/u") return fakeListing(dir, ["docs/", "src/"]); // no .agents
      if (dir === "/home/u/.agents") return fakeListing(dir, ["skills/"]);
      if (dir === "/home/u/.agents/skills") return fakeListing(dir, ["SKILL.md"]);
      return fakeListing(dir, []);
    },
  });
  await model.setRoot("/home/u");
  await model.revealFile("/home/u/.agents/skills/SKILL.md");
  assert.equal(model.activeFile(), "/home/u/.agents/skills/SKILL.md");
  assert.equal(model.selected(), "/home/u/.agents/skills/SKILL.md");
  assert.equal(model.expanded().has("/home/u"), true);
  assert.equal(model.expanded().has("/home/u/.agents"), true);
  assert.equal(model.expanded().has("/home/u/.agents/skills"), true);
  // Injected into the root listing even though list_dir omitted it.
  assert.ok(
    model.entriesOf("/home/u")?.some((e) => e.name === ".agents" && e.is_dir),
    "hidden folder must appear after reveal",
  );
  assert.deepEqual(
    model.entriesOf("/home/u/.agents/skills")?.map((e) => e.name),
    ["SKILL.md"],
  );
});

test("ensurePathVisible merges without clobbering existing entries", () => {
  const cache = new Map([
    ["/r", fakeListing("/r", ["a/", "z.md"]).entries],
  ]);
  ensurePathVisible(cache, "/r", "/r/.hidden/file.md");
  const names = cache.get("/r")!.map((e) => e.name);
  assert.ok(names.includes("a"));
  assert.ok(names.includes("z.md"));
  assert.ok(names.includes(".hidden"));
  assert.ok(cache.get("/r/.hidden")?.some((e) => e.name === "file.md"));
});

test("baseName and isHiddenName helpers", () => {
  assert.equal(baseName("/a/b/.c"), ".c");
  assert.equal(baseName("/"), "");
  assert.equal(isHiddenName(".agents"), true);
  assert.equal(isHiddenName("agents"), false);
});

test("revealFile clears a stale activeFile when the file is outside the root", async () => {
  const model = createWorkspaceModel({ listDir: async (d) => fakeListing(d, ["x.md"]) });
  await model.setRoot("/r");
  await model.revealFile("/r/x.md");
  assert.equal(model.activeFile(), "/r/x.md");
  // Switching to a doc outside the workspace must not leave the old file active.
  await model.revealFile("/other/y.md");
  assert.equal(model.activeFile(), null);
});

test("revealFile with no root clears activeFile", async () => {
  const model = createWorkspaceModel({ listDir: async (d) => fakeListing(d, []) });
  model.setActiveFile("/r/old.md");
  await model.revealFile("/r/new.md");
  assert.equal(model.activeFile(), null);
});

test("onChange fires on mutations", async () => {
  let n = 0;
  const model = createWorkspaceModel({ listDir: async (d) => fakeListing(d, ["a/"]) });
  model.onChange(() => { n += 1; });
  await model.setRoot("/r");
  model.select("/r/a");
  assert.ok(n >= 2);
});

test("refresh re-injects the active hidden path after re-list", async () => {
  const model = createWorkspaceModel({
    listDir: async (dir) => {
      // Never returns .agents — simulates show_hidden_files=false.
      if (dir === "/r") return fakeListing(dir, ["visible.md"]);
      if (dir === "/r/.agents") return fakeListing(dir, ["SKILL.md"]);
      return fakeListing(dir, []);
    },
  });
  await model.setRoot("/r");
  await model.revealFile("/r/.agents/SKILL.md");
  assert.ok(model.entriesOf("/r")?.some((e) => e.name === ".agents"));

  await model.refresh();
  // Injection must survive refresh so the open file stays reachable.
  assert.ok(
    model.entriesOf("/r")?.some((e) => e.name === ".agents"),
    "refresh must re-inject active hidden path",
  );
  assert.equal(model.activeFile(), "/r/.agents/SKILL.md");
});

test("refresh re-lists root and expanded subdirs, picking up new entries", async () => {
  const listings = new Map<string, string[]>([
    ["/r", ["a/", "x.md"]],
    ["/r/a", ["old.md"]],
  ]);
  const calls: string[] = [];
  const model = createWorkspaceModel({
    listDir: async (dir) => {
      calls.push(dir);
      return fakeListing(dir, listings.get(dir) ?? []);
    },
  });
  await model.setRoot("/r");
  await model.expand("/r/a");
  assert.deepEqual(model.entriesOf("/r/a")?.map((e) => e.name), ["old.md"]);

  // Disk change: new file appears under the expanded dir and at the root.
  listings.set("/r", ["a/", "x.md", "new.md"]);
  listings.set("/r/a", ["old.md", "fresh.md"]);
  calls.length = 0;
  await model.refresh();

  assert.deepEqual(calls.sort(), ["/r", "/r/a"].sort());
  assert.deepEqual(model.entriesOf("/r")?.map((e) => e.name), ["a", "x.md", "new.md"]);
  assert.deepEqual(model.entriesOf("/r/a")?.map((e) => e.name), ["old.md", "fresh.md"]);
});

test("refresh with no root is a no-op that still notifies", async () => {
  let n = 0;
  const model = createWorkspaceModel({
    listDir: async () => {
      throw new Error("listDir must not be called without a root");
    },
  });
  model.onChange(() => { n += 1; });
  await model.refresh();
  assert.equal(n, 1);
  assert.equal(model.root(), null);
});

test("concurrent refresh keeps the later listing, not a stale partial", async () => {
  type Deferred = { promise: Promise<void>; resolve: () => void };
  const deferred = (): Deferred => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  };

  const gate1 = deferred();
  let phase: "seed" | "first" | "second" = "seed";
  const model = createWorkspaceModel({
    listDir: async (dir) => {
      if (phase === "seed") return fakeListing(dir, ["seed.md"]);
      if (phase === "first") {
        await gate1.promise;
        return fakeListing(dir, ["stale.md"]);
      }
      return fakeListing(dir, ["fresh.md"]);
    },
  });
  await model.setRoot("/r");
  assert.deepEqual(model.entriesOf("/r")?.map((e) => e.name), ["seed.md"]);

  phase = "first";
  const first = model.refresh();
  // Yield so the first refresh parks on gate1.
  await Promise.resolve();
  await Promise.resolve();

  phase = "second";
  const second = model.refresh();
  gate1.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(model.entriesOf("/r")?.map((e) => e.name), ["fresh.md"]);
});
