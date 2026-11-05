import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import * as miniflare from "miniflare";
const { Miniflare } = miniflare;
const options = miniflare.convertV4MiniflareOptions || ((x) => x);
import { randomBytes } from "node:crypto";
test("collection permissions and multipart lifecycle through real local D1/R2", async () => {
  const password = randomBytes(24).toString("hex");
  const mf = new Miniflare(
    options({
      modules: true,
      scriptPath: "dist/index.js",
      compatibilityDate: "2026-01-01",
      d1Databases: ["DB"],
      r2Buckets: ["FILES"],
      bindings: {
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: password,
        STORAGE_LIMIT_BYTES: "2000",
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");

    async function req(path, method = "GET", data, cookie = "") {
      const response = await mf.dispatchFetch("http://localhost/api/" + path, {
        method,
        headers: { "content-type": "application/json", cookie },
        body: data ? JSON.stringify(data) : undefined,
      });
      return {
        status: response.status,
        data: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    }
    assert.equal((await req("collections")).status, 401);
    const login = await req("session", "POST", { username: "admin", password });
    assert.equal(login.status, 200);
    const ac = login.cookie;
    const created = await req("collections", "POST", { name: "Harbor" }, ac);
    assert.equal(created.status, 201, JSON.stringify(created));
    const id = created.data.id,
      token = created.data.token,
      base = "collections/" + id,
      share = "share/" + token;
    const root = await req(base + "/folders", "POST", { name: "Branding" }, ac);
    assert.equal(root.status, 201);
    const fid = root.data.id;
    const child = await req(
      base + "/folders",
      "POST",
      { name: "Logos", parent: fid },
      ac,
    );
    assert.equal(child.status, 201);
    const opened = await req(share + "/open", "POST", {});
    assert.equal(opened.status, 200);
    const rc = opened.cookie;
    assert.equal(
      (await req(share + "/folders", "POST", { name: "Forbidden" }, rc)).status,
      403,
    );
    assert.equal(
      (await req(share + "/folders/" + fid, "PATCH", { name: "Bad" }, rc))
        .status,
      403,
    );
    assert.equal(
      (await req(share + "/folders/" + fid, "DELETE", {}, rc)).status,
      403,
    );
    assert.equal(
      (await req(base, "PATCH", { create_folder: true, rename_own: true }, ac))
        .status,
      200,
    );
    const own = await req(
      share + "/folders",
      "POST",
      { name: "Recipient", parent: fid },
      rc,
    );
    assert.equal(own.status, 201);
    assert.equal(
      (
        await req(
          share + "/folders/" + own.data.id,
          "PATCH",
          { name: "Renamed" },
          rc,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await req(
          share + "/folders/" + own.data.id,
          "PATCH",
          { upload: true },
          rc,
        )
      ).status,
      403,
    );
    assert.equal(
      (await req(base + "/folders/" + fid, "PATCH", { hidden: true }, ac))
        .status,
      200,
    );
    assert.equal((await req(share, "GET", null, rc)).data.folders.length, 0);
    assert.equal(
      (
        await req(
          share + "/uploads",
          "POST",
          { name: "hidden.txt", size: 10, folder: fid },
          rc,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await req(
          base + "/folders/" + fid,
          "PATCH",
          { hidden: false, upload: false },
          ac,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await req(
          share + "/uploads",
          "POST",
          { name: "readonly.txt", size: 10, folder: child.data.id },
          rc,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await req(
          base + "/folders/" + child.data.id,
          "PATCH",
          { upload: true },
          ac,
        )
      ).status,
      200,
    );
    const init = await req(
      share + "/uploads",
      "POST",
      { name: "logo.txt", size: 5, folder: child.data.id },
      rc,
    );
    assert.equal(init.status, 201, JSON.stringify(init));
    const part = await req(
      share + "/uploads/" + init.data.id + "/part",
      "POST",
      { part: 1 },
      rc,
    );
    assert.equal(part.status, 200);
    assert.equal(
      (
        await req(
          share + "/uploads/" + init.data.id + "/part",
          "POST",
          { part: 2 },
          rc,
        )
      ).status,
      400,
    );
    const uploadResponse = await mf.dispatchFetch(part.data.url, {
      method: "PUT",
      headers: { cookie: rc, "content-length": "5" },
      body: new TextEncoder().encode("hello"),
    });
    assert.equal(
      uploadResponse.status,
      200,
      await uploadResponse.clone().text(),
    );
    const uploaded = await uploadResponse.json();
    const complete = await req(
      share + "/uploads/" + init.data.id + "/complete",
      "POST",
      { parts: [{ partNumber: uploaded.partNumber, etag: uploaded.etag }] },
      rc,
    );
    assert.equal(complete.status, 200, JSON.stringify(complete));
    const listed = await req(
      base + "/files?folder=" + child.data.id,
      "GET",
      null,
      ac,
    );
    assert.equal(listed.data[0].name, "logo.txt");
    assert.equal(
      (await req(base + "/files/" + init.data.id, "GET", null, ac)).status,
      200,
    );
    const quota = await req(
      share + "/uploads",
      "POST",
      { name: "oversize.txt", size: 2000, folder: child.data.id },
      rc,
    );
    assert.equal(quota.status, 409);
    assert.equal(
      (
        await req(
          base + "/folders/" + fid,
          "PATCH",
          { parent: child.data.id },
          ac,
        )
      ).status,
      400,
    );
    assert.equal(
      (await req(base, "PATCH", { create_folder: false }, ac)).status,
      200,
    );
    assert.equal(
      (await req(share + "/folders", "POST", { name: "Blocked again" }, rc))
        .status,
      403,
    );
    assert.equal((await req("session", "DELETE", null, ac)).status, 200);
    assert.equal((await req(base, "GET", null, ac)).status, 401);
  } finally {
    await mf.dispose();
  }
});
