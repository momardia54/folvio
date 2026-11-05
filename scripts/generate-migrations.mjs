import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => {
    const statements = [];
    let statement = "";
    for (const raw of readFileSync("migrations/" + name, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("--")) continue;
      statement += (statement ? " " : "") + line;
      if (
        line.endsWith(";") &&
        (!/^CREATE TRIGGER/i.test(statement) || /\bEND;$/i.test(statement))
      ) {
        statements.push(statement);
        statement = "";
      }
    }
    if (statement) throw Error("Incomplete migration: " + name);
    return { name, statements };
  });
writeFileSync(
  "src/migrations.js",
  "// Generated from migrations/*.sql by scripts/generate-migrations.mjs.\nexport default " +
    JSON.stringify(migrations, null, 2) +
    ";\n",
);
