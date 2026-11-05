import {ensureMigrated} from "./migrate.js";
import {
  random,
  hash,
  hmac,
  equal,
  cookieValue,
  cookie,
  fingerprint,
  fail,
  name,
  integer,
  permissions,
} from "./security.js";
const PART = 16 * 1024 * 1024;
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
const one = (e, sql, ...args) =>
  e.DB.prepare(sql)
    .bind(...args)
    .first();
const run = (e, sql, ...args) =>
  e.DB.prepare(sql)
    .bind(...args)
    .run();
const rows = async (e, sql, ...args) =>
  (
    await e.DB.prepare(sql)
      .bind(...args)
      .all()
  ).results;
async function body(r) {
  const reader = r.body?.getReader();
  let text = "",
    total = 0;
  const decoder = new TextDecoder();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 32000) {
        await reader.cancel();
        fail(413, "Request too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "Expected a JSON object.");
    return value;
  } catch {
    fail(400, "Invalid JSON.");
  }
}
async function admin(r, e) {
  const bearer = r.headers.get("authorization");
  if (bearer?.startsWith("Bearer "))
    return !!(await one(
      e,
      "SELECT id FROM api_keys WHERE hash=?",
      await hash(bearer.slice(7)),
    ));
  const token = cookieValue(r, "fv_session");
  if (!token || !e.ADMIN_PASSWORD || !e.ADMIN_USERNAME) return false;
  const s = await one(
    e,
    "SELECT cred FROM sessions WHERE id=? AND expires>?",
    await hash(token),
    Date.now(),
  );
  return !!s && equal(s.cred, await fingerprint(e));
}
async function throttle(r, e, scope) {
  const id = await hash(
    `${scope}:${r.headers.get("cf-connecting-ip") || "local"}`,
  );
  const now = Date.now();
  const a = await one(
    e,
    "INSERT INTO attempts(id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING count",
    id,
    now + 900000,
    now,
    now,
  );
  if (a.count > 30) fail(429, "Too many attempts. Try again in 15 minutes.");
}
async function recipient(r, e, c) {
  const value = cookieValue(r, "fv_" + c.id);
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig) return null;
  const expected = await hmac(
    e.SESSION_SECRET || e.ADMIN_PASSWORD,
    `${c.id}:${c.password || ""}:${id}`,
  );
  return equal(sig, expected) ? id : null;
}
async function publicCollection(e, token) {
  return (
    (await one(
      e,
      "SELECT *, NULL AS folder_root FROM collections WHERE token=?",
      token,
    )) ||
    (await one(
      e,
      "SELECT c.*, l.folder AS folder_root FROM collections c JOIN folder_links l ON l.collection=c.id WHERE l.token=?",
      token,
    ))
  );
}
function within(ctx, folder) {
  if (!ctx.c.folder_root) return true;
  const seen = new Set();
  while (folder && !seen.has(folder)) {
    if (folder === ctx.c.folder_root) return true;
    seen.add(folder);
    folder = ctx.folders.find((f) => f.id === folder)?.parent;
  }
  return false;
}
async function collectionContext(r, e, id, isAdmin) {
  const c = isAdmin
    ? await one(e, "SELECT * FROM collections WHERE id=?", id)
    : await publicCollection(e, id);
  if (!c) fail(404, "Collection not found.");
  let owner = "admin";
  if (!isAdmin) {
    if (c.expires && c.expires < Date.now())
      fail(410, "This collection has expired.");
    owner = await recipient(r, e, c);
    if (!owner) fail(401, "Open this collection to continue.");
  }
  const folders = await rows(
    e,
    "SELECT * FROM folders WHERE collection=?",
    c.id,
  );
  return { c, folders, owner };
}
function authorize(ctx, folder, action, isAdmin) {
  if (!isAdmin && !within(ctx, folder))
    fail(403, "This link does not allow access to that folder.");
  const p = permissions(ctx.c, ctx.folders, folder);
  if (!isAdmin && (p.hidden || !p[action]))
    fail(403, "You do not have permission for this folder.");
  return p;
}
function settings(b, c = {}) {
  const out = { ...c };
  for (const k of ["create_folder", "rename_own", "upload"])
    if (k in b) {
      if (typeof b[k] !== "boolean")
        fail(400, "Permissions must be true or false.");
      out[k] = Number(b[k]);
    }
  if ("name" in b) out.name = name(b.name);
  if ("description" in b) {
    if (typeof b.description !== "string" || b.description.length > 2000)
      fail(400, "Description is too long.");
    out.description = b.description;
  }
  if ("quota" in b) out.quota = integer(b.quota, 1, 8000000000);
  if ("max_file" in b) out.max_file = integer(b.max_file, 1, 2000000000);
  if ("expires" in b)
    out.expires =
      b.expires === null ? null : integer(b.expires, 1, 9007199254740991);
  return out;
}
async function api(r, e) {
  await ensureMigrated(e.DB);
  const u = new URL(r.url),
    p = u.pathname.split("/").filter(Boolean),
    method = r.method;
  if (
    !["GET", "HEAD"].includes(method) &&
    r.headers.get("origin") &&
    r.headers.get("origin") !== u.origin
  )
    fail(403, "Cross-origin request blocked.");
  const binaryPart =
    method === "PUT" && p.length === 6 && p[3] === "uploads" && p[5] === "part";
  if (
    Number(r.headers.get("content-length") || 0) > (binaryPart ? PART : 32000)
  )
    fail(413, "Request too large.");
  if (p[1] === "session") {
    if (method === "GET")
      return json({
        configured: !!(e.ADMIN_USERNAME && e.ADMIN_PASSWORD),
        username: (await admin(r, e)) ? e.ADMIN_USERNAME : null,
      });
    if (method === "DELETE") {
      const t = cookieValue(r, "fv_session");
      if (t) await run(e, "DELETE FROM sessions WHERE id=?", await hash(t));
      return json({ ok: true }, 200, {
        "Set-Cookie": cookie(r, "fv_session", "", 0),
      });
    }
    if (method === "POST") {
      if (!e.ADMIN_USERNAME || !e.ADMIN_PASSWORD)
        fail(
          503,
          "Configure ADMIN_USERNAME and ADMIN_PASSWORD in Worker secrets.",
        );
      await throttle(r, e, "login");
      const b = await body(r);
      const [a, z, x, y] = await Promise.all([
        hash(String(b.username || "")),
        hash(e.ADMIN_USERNAME),
        hash(String(b.password || "")),
        hash(e.ADMIN_PASSWORD),
      ]);
      if (!equal(a, z) || !equal(x, y))
        fail(401, "Invalid username or password.");
      const token = random();
      await run(
        e,
        "INSERT INTO sessions VALUES (?,?,?)",
        await hash(token),
        await fingerprint(e),
        Date.now() + 604800000,
      );
      return json({ ok: true }, 200, {
        "Set-Cookie": cookie(r, "fv_session", token),
      });
    }
  }
  const isAdmin = await admin(r, e);
  if (p[1] === "keys") {
    if (!isAdmin) fail(401, "Sign in required.");
    if (method === "GET")
      return json(
        await rows(
          e,
          "SELECT id,name,created FROM api_keys ORDER BY created DESC LIMIT 100",
        ),
      );
    if (method === "POST") {
      const b = await body(r),
        key = "fv_" + random(),
        id = random().slice(0, 24);
      await run(
        e,
        "INSERT INTO api_keys VALUES (?,?,?,?)",
        id,
        name(b.name),
        await hash(key),
        Date.now(),
      );
      return json({ id, key }, 201);
    }
    if (method === "DELETE") {
      await run(e, "DELETE FROM api_keys WHERE id=?", p[2] || "");
      return json({ ok: true });
    }
  }
  if (p[1] === "collections") {
    if (!isAdmin) fail(401, "Sign in required.");
    if (p.length === 2 && method === "GET")
      return json(
        await rows(
          e,
          "SELECT id,name,description,created,token FROM collections WHERE id>? ORDER BY id LIMIT 51",
          u.searchParams.get("after") || "",
        ),
      );
    if (p.length === 2 && method === "POST") {
      const b = await body(r),
        s = settings(b, {
          description: "",
          expires: null,
          quota: 1000000000,
          max_file: 100000000,
          create_folder: 0,
          rename_own: 0,
          upload: 1,
        });
      if (!s.name) fail(400, "Collection name required.");
      const id = random().slice(0, 24),
        token = random();
      const password = b.password
        ? await hmac(e.SESSION_SECRET || e.ADMIN_PASSWORD, String(b.password))
        : null;
      await run(
        e,
        "INSERT INTO collections(id,token,name,description,password,expires,quota,max_file,create_folder,rename_own,upload,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        token,
        s.name,
        s.description,
        password,
        s.expires,
        s.quota,
        s.max_file,
        s.create_folder,
        s.rename_own,
        s.upload,
        Date.now(),
      );
      return json({ id, token }, 201);
    }
  }
  const publicRoute = p[1] === "share";
  if (!publicRoute && p[1] !== "collections") fail(404, "Endpoint not found.");
  if (!publicRoute && !isAdmin) fail(401, "Sign in required.");
  const adminMode = !publicRoute && isAdmin,
    id = p[2];
  if (!id) fail(404, "Collection not found.");
  if (publicRoute && p[3] === "open" && method === "POST") {
    await throttle(r, e, "open");
    const c = await publicCollection(e, id);
    if (!c) fail(404, "Collection not found.");
    if (c.expires && c.expires < Date.now())
      fail(410, "This collection has expired.");
    const b = await body(r);
    if (
      c.password &&
      !equal(
        c.password,
        await hmac(
          e.SESSION_SECRET || e.ADMIN_PASSWORD,
          String(b.password || ""),
        ),
      )
    )
      fail(401, "Collection password required or incorrect.");
    const owner = (await recipient(r, e, c)) || random();
    const sig = await hmac(
      e.SESSION_SECRET || e.ADMIN_PASSWORD,
      `${c.id}:${c.password || ""}:${owner}`,
    );
    return json({ ok: true }, 200, {
      "Set-Cookie": cookie(r, "fv_" + c.id, owner + "." + sig),
    });
  }
  const ctx = await collectionContext(r, e, id, adminMode),
    { c, folders, owner } = ctx;
  if (p.length === 3) {
    if (method === "GET") {
      const visible = folders
        .filter(
          (f) =>
            adminMode ||
            (within(ctx, f.id) && !permissions(c, folders, f.id).hidden),
        )
        .map((f) => ({
          ...f,
          permissions: permissions(c, folders, f.id),
          own: f.creator === owner,
          creator: undefined,
        }));
      const { password, ...safe } = c;
      return json({
        ...safe,
        token: adminMode ? c.token : id,
        password_set: !!password,
        folders: visible,
        permissions: permissions(c, folders, c.folder_root || null),
      });
    }
    if (method === "PATCH" && adminMode) {
      const b = await body(r),
        s = settings(b, c);
      let password = c.password;
      if ("password" in b)
        password = b.password
          ? await hmac(e.SESSION_SECRET || e.ADMIN_PASSWORD, String(b.password))
          : null;
      const updated = await run(
        e,
        "UPDATE collections SET name=?,description=?,password=?,expires=?,quota=?,max_file=?,create_folder=?,rename_own=?,upload=? WHERE id=? AND revision=?",
        s.name,
        s.description,
        password,
        s.expires,
        s.quota,
        s.max_file,
        s.create_folder,
        s.rename_own,
        s.upload,
        c.id,
        c.revision,
      );
      if (!updated.meta.changes)
        fail(409, "Collection changed. Refresh and try again.");
      return json({ ok: true });
    }
  }
  if (p[3] === "links") {
    if (!adminMode) fail(403, "Administrator access required.");
    if (method === "POST") {
      const b = await body(r);
      if (!b.folder) fail(400, "Choose a folder.");
      permissions(c, folders, b.folder);
      const token = random();
      await run(
        e,
        "INSERT INTO folder_links VALUES (?,?,?,?)",
        token,
        c.id,
        b.folder,
        Date.now(),
      );
      return json({ token, folder: b.folder }, 201);
    }
    if (method === "GET")
      return json(
        await rows(
          e,
          "SELECT token,folder,created FROM folder_links WHERE collection=? ORDER BY created DESC LIMIT 100",
          c.id,
        ),
      );
    if (method === "DELETE" && p[4]) {
      await run(
        e,
        "DELETE FROM folder_links WHERE token=? AND collection=?",
        p[4],
        c.id,
      );
      return json({ ok: true });
    }
  }
  if (p[3] === "folders") {
    const target = p[4];
    if (method === "POST" && !target) {
      const b = await body(r),
        parent = b.parent || c.folder_root || null;
      authorize(ctx, parent, "create_folder", adminMode);
      if (folders.length >= 200)
        fail(409, "Limit of 200 folders per collection reached.");
      let depth = 0;
      for (let f = parent; f; f = folders.find((x) => x.id === f)?.parent)
        if (++depth >= 19) fail(400, "Maximum folder depth reached.");
      const fid = random().slice(0, 24);
      const inserted = await run(
        e,
        "INSERT INTO folders(id,collection,parent,name,creator) SELECT ?,?,?,?,? WHERE (SELECT revision FROM collections WHERE id=?)=? AND (SELECT count(*) FROM folders WHERE collection=?)<200",
        fid,
        c.id,
        parent,
        name(b.name),
        owner,
        c.id,
        c.revision,
        c.id,
      );
      if (!inserted.meta.changes)
        fail(409, "Collection changed. Refresh and try again.");
      return json({ id: fid }, 201);
    }
    const f = folders.find((x) => x.id === target);
    if (!f) fail(404, "Folder not found.");
    if (method === "PATCH") {
      const b = await body(r);
      authorize(ctx, f.id, "rename_own", adminMode);
      if (
        !adminMode &&
        (f.creator !== owner || Object.keys(b).some((k) => k !== "name"))
      )
        fail(403, "You can only rename folders you created.");
      const parent = "parent" in b ? b.parent || null : f.parent;
      if (parent) permissions(c, folders, parent);
      let cursor = parent;
      while (cursor) {
        if (cursor === f.id) fail(400, "Cannot move a folder into itself.");
        cursor = folders.find((x) => x.id === cursor)?.parent;
      }
      const revised = folders.map((x) =>
        x.id === f.id ? { ...x, parent } : x,
      );
      for (const x of revised) permissions(c, revised, x.id);
      const changes = {
        ...f,
        parent,
        name: "name" in b ? name(b.name) : f.name,
      };
      for (const k of ["upload", "create_folder", "rename_own", "hidden"])
        if (k in b) {
          if (b[k] !== null && typeof b[k] !== "boolean")
            fail(400, "Invalid permission.");
          changes[k] = b[k] === null ? null : Number(b[k]);
        }
      if (changes.hidden === null) changes.hidden = 0;
      // Serialize competing moves and permission edits with an optimistic snapshot check.
      const result = await run(
        e,
        "UPDATE folders SET parent=?,name=?,upload=?,create_folder=?,rename_own=?,hidden=? WHERE id=? AND (SELECT revision FROM collections WHERE id=?)=?",
        changes.parent,
        changes.name,
        changes.upload,
        changes.create_folder,
        changes.rename_own,
        changes.hidden,
        f.id,
        c.id,
        c.revision,
      );
      if (!result.meta.changes)
        fail(409, "Folders changed. Refresh and try again.");
      return json({ ok: true });
    }
    if (method === "DELETE") {
      if (!adminMode) fail(403, "Only administrators can delete folders.");
      if (
        folders.some((x) => x.parent === f.id) ||
        (await one(e, "SELECT id FROM uploads WHERE folder=? LIMIT 1", f.id))
      )
        fail(409, "Move or delete the contents first.");
      await run(e, "DELETE FROM folders WHERE id=?", f.id);
      return json({ ok: true });
    }
  }
  if (p[3] === "files" && p.length === 4 && method === "GET") {
    const folder = u.searchParams.get("folder") || c.folder_root || null;
    if (!adminMode && !within(ctx, folder))
      fail(403, "This link does not allow access to that folder.");
    const permission = permissions(c, folders, folder);
    if (!adminMode && permission.hidden) fail(404, "Folder not found.");
    const files = await rows(
      e,
      `SELECT id,name,size,created FROM uploads WHERE collection=? AND folder IS ? AND state='complete' ${adminMode ? "" : "AND owner=?"} AND id>? ORDER BY id LIMIT 51`,
      ...[
        c.id,
        folder,
        ...(adminMode ? [] : [owner]),
        u.searchParams.get("after") || "",
      ],
    );
    return json(files);
  }
  if (p[3] === "files" && p[4]) {
    if (!adminMode) fail(403, "Administrator access required.");
    const file = await one(
      e,
      "SELECT * FROM uploads WHERE id=? AND collection=? AND state='complete'",
      p[4],
      c.id,
    );
    if (!file) fail(404, "File not found.");
    if (method === "DELETE") {
      await e.FILES.delete(file.object_key);
      await run(e, "DELETE FROM uploads WHERE id=?", file.id);
      return json({ ok: true });
    }
    if (method === "PATCH") {
      const b = await body(r);
      const destination = "folder" in b ? b.folder || null : file.folder;
      permissions(c, folders, destination);
      await run(
        e,
        "UPDATE uploads SET name=?,folder=? WHERE id=?",
        "name" in b ? name(b.name) : file.name,
        destination,
        file.id,
      );
      return json({ ok: true });
    }
    if (method === "GET") {
      if (
        u.searchParams.get("download") !== "1" &&
        u.searchParams.get("preview") !== "1"
      )
        return json({ url: u.origin + u.pathname + "?download=1" });
      const object = await e.FILES.get(file.object_key);
      if (!object) fail(404, "Stored file not found.");
      const mimeTypes = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        avif: "image/avif",
      };
      const extension = file.name.split(".").pop().toLowerCase();
      const mime = Object.hasOwn(mimeTypes,extension) ? mimeTypes[extension] : null;
      const preview = u.searchParams.get("preview") === "1";
      if (preview && (!mime || file.size > 10000000))
        fail(400, "Preview unavailable for this file.");
      return new Response(object.body, {
        headers: {
          "Content-Type": preview ? mime : "application/octet-stream",
          "Content-Length": String(object.size),
          "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "Cache-Control": "private, no-store",
        },
      });
    }
  }
  if (p[3] === "uploads") {
    if (method === "POST" && !p[4]) {
      const b = await body(r),
        folder = b.folder || c.folder_root || null;
      authorize(ctx, folder, "upload", adminMode);
      const size = integer(b.size, 1, c.max_file),
        uid = random().slice(0, 24),
        key = `uploads/${c.id}/${uid}`,
        now = Date.now();
      const inserted = await run(
        e,
        "INSERT INTO uploads(id,collection,folder,owner,name,size,object_key,expires,created) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT coalesce(sum(size),0) FROM uploads WHERE collection=?) + ? <= ? AND (SELECT coalesce(sum(size),0) FROM uploads) + ? <= ?",
        uid,
        c.id,
        folder,
        owner,
        name(b.name),
        size,
        key,
        now + 3600000,
        now,
        c.id,
        size,
        c.quota,
        size,
        Number(e.STORAGE_LIMIT_BYTES || 8000000000),
      );
      if (!inserted.meta.changes)
        fail(409, "Storage quota reached, including reserved uploads.");
      try {
        const mp = await e.FILES.createMultipartUpload(key);
        await run(
          e,
          "UPDATE uploads SET multipart=? WHERE id=?",
          mp.uploadId,
          uid,
        );
      } catch (error) {
        await run(e, "DELETE FROM uploads WHERE id=?", uid);
        throw error;
      }
      return json(
        { id: uid, part_size: PART, parts: Math.ceil(size / PART) },
        201,
      );
    }
    const up = await one(
      e,
      "SELECT * FROM uploads WHERE id=? AND collection=?",
      p[4] || "",
      c.id,
    );
    if (!up || (!adminMode && up.owner !== owner))
      fail(404, "Upload not found.");
    authorize(ctx, up.folder, "upload", adminMode);
    if (up.state === "complete" && p[5] === "complete" && method === "POST")
      return json({ ok: true });
    if (up.expires < Date.now()) fail(410, "Upload authorization expired.");
    if (p[5] === "part" && method === "POST") {
      if (up.state !== "pending") fail(409, "Upload is being completed.");
      const b = await body(r),
        part = integer(b.part, 1, Math.ceil(up.size / PART)),
        size = Math.min(PART, up.size - (part - 1) * PART);
      return json({ url: u.origin + u.pathname + "?part=" + part, size });
    }
    if (p[5] === "part" && method === "PUT") {
      if (up.state !== "pending") fail(409, "Upload is being completed.");
      const part = integer(
        Number(u.searchParams.get("part")),
        1,
        Math.ceil(up.size / PART),
      );
      const expected = Math.min(PART, up.size - (part - 1) * PART);
      if (!r.headers.has("content-length"))
        fail(411, "Content-Length is required.");
      if (Number(r.headers.get("content-length")) !== expected || !r.body)
        fail(400, "Part size does not match the reserved size.");
      // Pass the fixed-length HTTP body directly to R2. Never buffer file contents in JS.
      const uploaded = await e.FILES.resumeMultipartUpload(
        up.object_key,
        up.multipart,
      ).uploadPart(part, r.body);
      return json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
    }
    if (p[5] === "complete" && method === "POST") {
      const b = await body(r);
      if (
        !Array.isArray(b.parts) ||
        b.parts.length !== Math.ceil(up.size / PART) ||
        b.parts.some(
          (x, i) =>
            !x ||
            x.partNumber !== i + 1 ||
            typeof x.etag !== "string" ||
            x.etag.length > 256,
        )
      )
        fail(400, "Invalid part manifest.");
      const claimed = await run(
        e,
        "UPDATE uploads SET state='completing' WHERE id=? AND state IN ('pending','completing')",
        up.id,
      );
      if (!claimed.meta.changes)
        fail(409, "Upload is no longer available for completion.");
      let object = await e.FILES.head(up.object_key);
      if (!object) {
        try {
          await e.FILES.resumeMultipartUpload(
            up.object_key,
            up.multipart,
          ).complete(b.parts);
        } catch (error) {
          object = await e.FILES.head(up.object_key);
          if (!object) throw error;
        }
        object = await e.FILES.head(up.object_key);
      }
      if (!object || object.size !== up.size) {
        await e.FILES.delete(up.object_key);
        await run(e, "DELETE FROM uploads WHERE id=?", up.id);
        fail(400, "Uploaded size does not match reserved size.");
      }
      await run(e, "UPDATE uploads SET state='complete' WHERE id=?", up.id);
      return json({ ok: true });
    }
    if (method === "DELETE") {
      if (up.state !== "pending")
        fail(409, "Only pending uploads can be cancelled.");
      const claimed = await run(
        e,
        "UPDATE uploads SET state='cancelling' WHERE id=? AND state='pending'",
        up.id,
      );
      if (!claimed.meta.changes)
        fail(409, "Upload state changed. Refresh and try again.");
      await e.FILES.resumeMultipartUpload(up.object_key, up.multipart).abort();
      await e.FILES.delete(up.object_key);
      await run(e, "DELETE FROM uploads WHERE id=?", up.id);
      return json({ ok: true });
    }
  }
  fail(405, "Unsupported operation.");
}
export async function cleanup(e) {
  await ensureMigrated(e.DB);
  const expired = await rows(
    e,
    "SELECT * FROM uploads WHERE state!='complete' AND expires<? LIMIT 5",
    Date.now() - 600000,
  );
  for (const up of expired) {
    try {
      if (up.multipart)
        await e.FILES.resumeMultipartUpload(
          up.object_key,
          up.multipart,
        ).abort();
      await e.FILES.delete(up.object_key);
      await run(
        e,
        "DELETE FROM uploads WHERE id=? AND state!='complete'",
        up.id,
      );
    } catch {
      /* Keep reservation and retry next run. R2 lifecycle is the fallback. */
    }
  }
  await e.DB.batch([
    e.DB.prepare(
      "DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires<? LIMIT 200)",
    ).bind(Date.now()),
    e.DB.prepare(
      "DELETE FROM attempts WHERE id IN (SELECT id FROM attempts WHERE expires<? LIMIT 200)",
    ).bind(Date.now()),
  ]);
}
export default {
  async fetch(r, e) {
    try {
      const response = new URL(r.url).pathname.startsWith("/api/")
        ? await api(r, e)
        : await e.ASSETS.fetch(r);
      const result = new Response(response.body, response);
      result.headers.set("X-Content-Type-Options", "nosniff");
      result.headers.set("Referrer-Policy", "no-referrer");
      result.headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      );
      return result;
    } catch (error) {
      return json(
        {
          error: error.status
            ? error.message
            : String(error).includes("UNIQUE")
              ? "A folder with that name already exists."
              : "Request failed. Please retry.",
        },
        error.status || (String(error).includes("UNIQUE") ? 409 : 500),
      );
    }
  },
  scheduled(event, e, ctx) {
    ctx.waitUntil(cleanup(e));
  },
};
