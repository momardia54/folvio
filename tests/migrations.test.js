import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "./harness.js";
import { ensureMigrated } from "../src/migrate.js";
import migrations from "../src/migrations.js";
test("fresh database migrates once under concurrent requests and survives a cold restart", async () => {
  const instance = new Miniflare({ bindings: {} });
  try {
    await Promise.all(
      Array.from({ length: 8 }, () => ensureMigrated(instance.DB)),
    );
    assert.equal(
      (
        await instance.DB.prepare(
          "SELECT count(*) AS count FROM d1_migrations",
        ).first()
      ).count,
      3,
    );
    await ensureMigrated({ ...instance.DB });
    assert.equal(
      (
        await instance.DB.prepare(
          "SELECT count(*) AS count FROM d1_migrations",
        ).first()
      ).count,
      3,
    );
    assert.ok(
      await instance.DB.prepare(
        "SELECT name FROM sqlite_master WHERE name='folder_links'",
      ).first(),
    );
  } finally {
    await instance.dispose();
  }
});
test("bundled migrations exactly match source SQL", async () => {
  assert.deepEqual(
    migrations.map((m) => m.name),
    (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort(),
  );
  for (const m of migrations) {
    const source = (await readFile("migrations/" + m.name, "utf8"))
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    assert.equal(m.statements.join(" ").replace(/\s+/g, " ").trim(), source);
  }
});
