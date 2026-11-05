import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import puppeteer from "puppeteer-core";
test("desktop and mobile collection wizard, folder controls, recipient permissions", async () => {
  const password = crypto.randomUUID();
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "dist/index.js",
      compatibilityDate: "2026-01-01",
      d1Databases: ["DB"],
      r2Buckets: ["FILES"],
      bindings: { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: password },
      serviceBindings: {
        ASSETS: async (r) => {
          const path = new URL(r.url).pathname;
          const file = ["/app.js", "/style.css", "/favicon.svg"].includes(path)
            ? path
            : "/index.html";
          return new Response(await readFile("public" + file), {
            headers: {
              "content-type": file.endsWith(".js")
                ? "text/javascript"
                : file.endsWith(".css")
                  ? "text/css"
                  : file.endsWith(".svg")
                    ? "image/svg+xml"
                    : "text/html",
            },
          });
        },
      },
    }),
  );
  let browser;
  try {
    const db = await mf.getD1Database("DB");
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const origin = (await mf.ready).origin;
    await page.goto(origin);
    await page.waitForSelector("#login");
    await page.type("[name=username]", "admin");
    await page.type("[name=password]", password);
    await page.click("#login button");
    await page.waitForSelector("#new");
    await page.click("#new");
    await page.type("[name=name]", "Harbor Studio");
    await page.type("[name=description]", "Project files");
    await page.click("#wizard .primary");
    await page.waitForSelector("[name=quota_mb]");
    await page.click("#wizard .primary");
    await page.waitForSelector("#draft-add");
    async function add(name, parent = "") {
      await page.click("#draft-add");
      await page.waitForSelector("dialog[open]");
      await page.type("dialog [name=name]", name);
      if (parent) await page.select("dialog [name=parent]", parent);
      await page.click("#modal-form .primary");
      await page.waitForSelector("dialog[open]", { hidden: true });
    }
    await add("Branding");
    const parent = await page.$eval("[data-draft]", (e) => e.dataset.draft);
    await add("Logos", parent);
    await page.click("#wizard .primary");
    assert.equal(
      await page.$eval("[name=create_folder]", (e) => e.checked),
      false,
    );
    await page.click("#wizard .primary");
    await page.click("#wizard .primary");
    await page.waitForSelector("#share");
    await page.waitForSelector("dialog[open]");
    await page.click("#cancel");
    const c = await db.prepare("SELECT * FROM collections").first();
    const folder = await db
      .prepare("SELECT * FROM folders WHERE name='Logos'")
      .first();
    assert.ok(folder.parent);
    await page.click('[data-folder="' + folder.id + '"]');
    await page.waitForSelector("#edit-folder");
    await page.click("#edit-folder");
    await page.$eval("dialog [name=name]", (e) => (e.value = ""));
    await page.type("dialog [name=name]", "Logo files");
    await page.click("#modal-form .primary");
    await page.waitForSelector("dialog[open]", { hidden: true });
    assert.equal(
      (
        await db
          .prepare("SELECT name FROM folders WHERE id=?")
          .bind(folder.id)
          .first()
      ).name,
      "Logo files",
    );
    const context = await browser.createBrowserContext(),
      recipient = await context.newPage();
    await recipient.goto(origin + "/s/" + c.token);
    await recipient.waitForSelector("#upload");
    assert.equal(await recipient.$("#add-folder"), null);
    assert.equal(await recipient.$("#edit-folder"), null);
    await page.click("#settings-tab");
    await page.waitForSelector("#settings-form");
    await page.click("#settings-form [name=create_folder]");
    await page.click("#settings-form [name=rename_own]");
    await page.click("#settings-form .primary");
    await page.waitForFunction(
      () => document.querySelector("#notice").textContent === "Settings saved",
    );
    await recipient.reload();
    await recipient.waitForSelector("#add-folder");
    await recipient.click("#add-folder");
    await recipient.type("dialog [name=name]", "Client folder");
    await recipient.click("#modal-form .primary");
    await recipient.waitForSelector("dialog[open]", { hidden: true });
    assert.ok(
      await db
        .prepare("SELECT id FROM folders WHERE name='Client folder'")
        .first(),
    );
    await page.click("#files-tab");
    await page.waitForSelector("#upload");
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(["Project brand guidelines"], "Brand guidelines.txt"),
      );
      const input = document.querySelector("#upload");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#file-list")
        ?.textContent.includes("Brand guidelines.txt"),
    );
    const received = await db
      .prepare("SELECT id FROM uploads WHERE name='Brand guidelines.txt'")
      .first();
    assert.ok(received);
    await page.click("#folder-link");
    await page.waitForSelector("dialog[open] .linkbox");
    const scopedURL = await page.$eval("dialog .linkbox", (e) => e.textContent);
    await page.click("#cancel");
    const scopedPage = await context.newPage();
    await scopedPage.goto(scopedURL);
    await scopedPage.waitForSelector("#upload");
    assert.equal(
      await scopedPage.$$eval("[data-folder]", (es) => es.length),
      1,
    );
    await scopedPage.close();
    await mkdir("test-results", { recursive: true });
    await page.click("#files-tab");
    await page.waitForSelector("#upload");
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 900 });
      await page.screenshot({
        path: `test-results/dashboard-${width}.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }

    await page.setViewport({ width: 1440, height: 900 });
    await page.click("#theme");
    assert.equal(
      await page.$eval("body", (e) => e.classList.contains("dark")),
      true,
    );
    await page.screenshot({
      path: "test-results/dashboard-dark.png",
      fullPage: true,
    });
    await page.click("#theme");
    await page.click('[data-folder="' + folder.id + '"]');
    await page.waitForSelector('[data-manage="' + received.id + '"]');
    await page.click('[data-manage="' + received.id + '"]');
    await page.$eval("dialog [name=name]", (e) => (e.value = ""));
    await page.type("dialog [name=name]", "Approved guidelines.txt");
    await page.select("dialog [name=folder]", "");
    await page.click("#modal-form .primary");
    await page.waitForSelector("dialog[open]", { hidden: true });
    const moved = await db
      .prepare("SELECT name,folder FROM uploads WHERE id=?")
      .bind(received.id)
      .first();
    assert.equal(moved.name, "Approved guidelines.txt");
    assert.equal(moved.folder, null);
    await page.click("#edit-folder");
    await page.select("dialog [name=parent]", "");
    await page.click("#modal-form .primary");
    await page.waitForSelector("dialog[open]", { hidden: true });
    assert.equal(
      (
        await db
          .prepare("SELECT parent FROM folders WHERE id=?")
          .bind(folder.id)
          .first()
      ).parent,
      null,
    );
    await page.click("#edit-folder");
    await page.click("#delete-folder");
    await page.waitForSelector("dialog[open]", { hidden: true });
    assert.equal(
      await db
        .prepare("SELECT id FROM folders WHERE id=?")
        .bind(folder.id)
        .first(),
      null,
    );
    await page.click("#nav-api");
    await page.waitForSelector("#new-key");
    await page.click("#new-key");
    await page.type("dialog [name=name]", "Browser integration");
    await page.click("#modal-form .primary");
    await page.waitForFunction(() =>
      document
        .querySelector("dialog[open] .linkbox")
        ?.textContent.startsWith("fv_"),
    );
    assert.equal(
      (await db.prepare("SELECT count(*) AS n FROM api_keys").first()).n,
      1,
    );
    await page.click("#cancel");
    await page.click("[data-revoke]");
    await page.click("#modal-form .primary");
    await page.waitForSelector("dialog[open]", { hidden: true });
    assert.equal(
      (await db.prepare("SELECT count(*) AS n FROM api_keys").first()).n,
      0,
    );
    await page.click("#nav-collections");
    await page.waitForSelector("[data-collection]");
    assert.equal(await page.$$eval("[data-collection]", (es) => es.length), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await mf.dispose();
  }
});
