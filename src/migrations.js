// Generated from migrations/*.sql by scripts/generate-migrations.mjs.
export default [
  {
    "name": "0001_init.sql",
    "statements": [
      "PRAGMA foreign_keys = ON;",
      "CREATE TABLE sessions (id TEXT PRIMARY KEY, cred TEXT NOT NULL, expires INTEGER NOT NULL);",
      "CREATE INDEX sessions_expiry ON sessions(expires);",
      "CREATE TABLE attempts (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);",
      "CREATE TABLE collections (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', password TEXT, expires INTEGER, quota INTEGER NOT NULL DEFAULT 1000000000, max_file INTEGER NOT NULL DEFAULT 100000000, create_folder INTEGER NOT NULL DEFAULT 0, rename_own INTEGER NOT NULL DEFAULT 0, upload INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);",
      "CREATE TABLE folders (id TEXT PRIMARY KEY, collection TEXT NOT NULL REFERENCES collections(id), parent TEXT REFERENCES folders(id), name TEXT NOT NULL, creator TEXT NOT NULL, create_folder INTEGER, rename_own INTEGER, upload INTEGER, hidden INTEGER NOT NULL DEFAULT 0);",
      "CREATE INDEX folders_collection ON folders(collection,parent);",
      "CREATE UNIQUE INDEX folder_names ON folders(collection,ifnull(parent,''),name);",
      "CREATE TABLE uploads (id TEXT PRIMARY KEY, collection TEXT NOT NULL REFERENCES collections(id), folder TEXT REFERENCES folders(id), owner TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE, multipart TEXT, state TEXT NOT NULL DEFAULT 'pending', expires INTEGER NOT NULL, created INTEGER NOT NULL);",
      "CREATE INDEX upload_listing ON uploads(collection,folder,state,id);",
      "CREATE INDEX upload_expiry ON uploads(state,expires);",
      "CREATE INDEX upload_quota ON uploads(collection,state,size);",
      "CREATE TABLE api_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, created INTEGER NOT NULL);"
    ]
  },
  {
    "name": "0002_collection_revisions.sql",
    "statements": [
      "ALTER TABLE collections ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;",
      "CREATE TRIGGER collection_revision AFTER UPDATE ON collections WHEN NEW.revision = OLD.revision BEGIN UPDATE collections SET revision=revision+1 WHERE id=NEW.id; END;",
      "CREATE TRIGGER folder_insert_revision AFTER INSERT ON folders BEGIN UPDATE collections SET revision=revision+1 WHERE id=NEW.collection; END;",
      "CREATE TRIGGER folder_update_revision AFTER UPDATE ON folders BEGIN UPDATE collections SET revision=revision+1 WHERE id=NEW.collection; END;",
      "CREATE TRIGGER folder_delete_revision AFTER DELETE ON folders BEGIN UPDATE collections SET revision=revision+1 WHERE id=OLD.collection; END;"
    ]
  },
  {
    "name": "0003_folder_links.sql",
    "statements": [
      "CREATE TABLE folder_links ( token TEXT PRIMARY KEY, collection TEXT NOT NULL REFERENCES collections(id), folder TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, created INTEGER NOT NULL );",
      "CREATE INDEX folder_links_collection ON folder_links(collection,folder);"
    ]
  }
];
