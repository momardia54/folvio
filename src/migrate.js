import migrations from "./migrations.js";
const ready = new WeakMap();
export function ensureMigrated(db) {
  let promise = ready.get(db);
  if (!promise) {
    promise = migrate(db).catch((error) => {
      ready.delete(db);
      throw error;
    });
    ready.set(db, promise);
  }
  return promise;
}
async function migrate(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
    )
    .run();
  const applied = new Set(
    (await db.prepare("SELECT name FROM d1_migrations").all()).results.map(
      (row) => row.name,
    ),
  );
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      await db.batch([
        ...migration.statements.map((sql) => db.prepare(sql)),
        db
          .prepare("INSERT INTO d1_migrations(name) VALUES (?)")
          .bind(migration.name),
      ]);
    } catch (error) {
      // Another cold Worker may have won the atomic migration batch.
      if (
        !(await db
          .prepare("SELECT name FROM d1_migrations WHERE name=?")
          .bind(migration.name)
          .first())
      )
        throw error;
    }
  }
}
