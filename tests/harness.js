import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";
export class Miniflare {
  constructor(options) {
    this.db = new DatabaseSync(":memory:");
    this.objects = new Map();
    this.parts = new Map();
    const database = this.db;
    this.DB = {
      exec: async (sql) => {
        database.exec(sql);
        database.exec(
          "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
        );
        const names = [];
        if (sql.includes("CREATE TABLE sessions")) names.push("0001_init.sql");
        if (sql.includes("ADD COLUMN revision"))
          names.push("0002_collection_revisions.sql");
        if (sql.includes("CREATE TABLE folder_links"))
          names.push("0003_folder_links.sql");
        for (const name of names)
          database
            .prepare("INSERT OR IGNORE INTO d1_migrations(name) VALUES (?)")
            .run(name);
      },
      prepare(sql) {
        let args = [];
        const statement = {
          bind(...values) {
            args = values;
            return statement;
          },
          async first() {
            return database.prepare(sql).get(...args) || null;
          },
          async all() {
            return { results: database.prepare(sql).all(...args) };
          },
          async run() {
            const result = database.prepare(sql).run(...args);
            return { meta: { changes: Number(result.changes) } };
          },
        };
        return statement;
      },
      async batch(statements) {
        database.exec("BEGIN");
        try {
          const result = await Promise.all(statements.map((s) => s.run()));
          database.exec("COMMIT");
          return result;
        } catch (e) {
          database.exec("ROLLBACK");
          throw e;
        }
      },
    };
    const objects = this.objects,
      uploads = this.parts;
    this.FILES = {
      async createMultipartUpload(key) {
        const uploadId = crypto.randomUUID();
        uploads.set(uploadId, new Map());
        return { uploadId };
      },
      resumeMultipartUpload(key, id) {
        return {
          async uploadPart(n, data) {
            uploads
              .get(id)
              .set(
                n,
                data instanceof ReadableStream
                  ? new Uint8Array(await new Response(data).arrayBuffer())
                  : new Uint8Array(data),
              );
            return { partNumber: n, etag: "etag-" + n };
          },
          async complete(parts) {
            let size = 0;
            for (const p of parts) {
              const data = uploads.get(id)?.get(p.partNumber);
              if (!data) throw Error("missing part");
              size += data.length;
            }
            objects.set(key, { size });
            uploads.delete(id);
            return { size };
          },
          async abort() {
            uploads.delete(id);
          },
        };
      },
      async get(key) {
        const object = objects.get(key);
        return object
          ? {
              ...object,
              body: new Blob([new Uint8Array(object.size)]).stream(),
            }
          : null;
      },
      async head(key) {
        return objects.get(key) || null;
      },
      async delete(key) {
        objects.delete(key);
      },
    };
    this.env = { ...options.bindings, DB: this.DB, FILES: this.FILES };
  }
  async getD1Database() {
    return this.DB;
  }
  async getR2Bucket() {
    return this.FILES;
  }
  async dispose() {
    this.db.close();
  }
  async dispatchFetch(url, init) {
    return worker.fetch(new Request(url, init), this.env);
  }
}
