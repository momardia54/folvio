<p align="center"><img src="public/favicon.svg" alt="Folvio logo" width="88" height="88"></p>

<h1 align="center">Folvio</h1>

<p align="center">
  Self-hosted file collections on Cloudflare Workers, D1 and R2.<br>
  Prepare the folders. Share a link. Receive every file in the right place.
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.1.0-6e77f0">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-lightgrey">
  <a href="https://github.com/sponsors/momardia54"><img alt="Sponsor" src="https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2?logo=githubsponsors&amp;logoColor=white"></a>
</p>

<p align="center">
  <a href="#deploy">Deploy</a> · <a href="API.md">API</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="ROADMAP.md">Roadmap</a> · <a href="SECURITY.md">Security</a>
</p>

> **Status: pre-1.0 — version 0.1.0, unreleased.** In-process, Cloudflare-emulator and desktop/mobile browser tests pass. Remote authentication and folder permissions are verified on staging; small-file and 105 MiB transfers through the Worker are verified; see the remaining release checks. The API and data model may change before 1.0. See [acceptance checks](ACCEPTANCE.md).

![Folvio dashboard](assets/screenshots/dashboard.png)

<details>
<summary>More screenshots</summary>

![Dark theme](assets/screenshots/dashboard-dark.png)

<img src="assets/screenshots/mobile.png" alt="Mobile collection dashboard" width="390">

</details>

## Why Folvio

Collecting project files should not mean sorting through email attachments and shared-drive links. Folvio gives each project one collection link, with the folder structure already prepared and upload permissions under your control.

One administrator manages the installation. Recipients open a link, enter a collection password if required, and upload into the folders you allow. Recipient folder creation is disabled by default.

## Quick start

1. **Deploy** using the setup below, then configure the administrator login and private R2 bucket.
2. **Create a collection** with its name, description, password, expiration and upload limits.
3. **Prepare folders** and configure recipient permissions before sharing.
4. **Share the link** and find uploaded files in the matching dashboard folders.

```text
Harbor Studio/
├── Branding/
│   ├── Logos/
│   └── Brand Guidelines/
├── Images/
│   ├── Team Photos/
│   └── Homepage/
├── Documents/
└── Other/
```

Change folders or collection settings later without changing the public URL.

## Features

- Five-step collection creation with an editable nested folder tree.
- Stable, randomly generated collection URLs, optional passwords and expiration.
- Administrator folder creation, rename, move, deletion of empty folders, and inherited permissions.
- Recipient folder creation **off by default**; optional creation and own-folder renaming. Recipients never move/delete folders or change permissions.
- Per-folder upload/create/rename overrides; hidden ancestors hide the entire subtree. A read-only folder has upload and folder creation disabled; set own-folder rename to denied too if needed.
- File listing, direct downloads and deletion for the administrator. Recipients see only their own uploaded files, identified by their browser cookie.
- Browser → Worker → R2 multipart uploads, exact part-length checks, atomic quota reservations, completion size verification and bounded hourly cleanup.
- Grid/list file browser with small raster previews, loaded-file search, selection, rename, move, delete and download.
- Folder-specific upload links restricted to the selected directory and its descendants.
- Revocable administrator API keys, login throttling, opaque server-side login sessions, and password changes invalidating administrator sessions.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/momardia54/folvio)

The button targets `momardia54/folvio`. Push this source to GitHub before using the button. The CLI installer below automatically finds or creates the D1 database and R2 bucket, applies migrations, configures abandoned-multipart cleanup, and deploys the Worker.

### Cloudflare dashboard / Git-connected builds

Cloudflare's default `npx wrangler deploy` command is supported. `npm run build` is an optional build command. The repository intentionally omits account-specific D1 IDs: Wrangler provisions or resolves the named D1 database and R2 bucket automatically. The Worker applies bundled database migrations on its first API request, with migration records preventing duplicate work.

If upgrading from the initial commit that failed with **10021**, push the corrected `wrangler.jsonc` (without `database_id: "replace-after-creation"`) and retry the build. Keep the R2 bucket already created by that run; Wrangler reuses the named resources. No dashboard command changes or manual database ID are required.

`npm run deploy` remains available for CLI installation; it also configures a one-day abandoned-multipart lifecycle rule. Raw Wrangler deployment uses the bucket's lifecycle settings plus Folvio's hourly cleanup.

For non-production branches, use a separate Worker/database configuration; do not point preview deployments at production data.

### CLI installation

Use Node 22.13 or newer. Activate R2 in your Cloudflare account first; a payment method may be required even within the free allowance.

```bash
npm ci
npx wrangler login
npm run deploy
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

If your login has several accounts, set `CLOUDFLARE_ACCOUNT_ID` to the account you want before deploying. Choose a strong unique password and a random session secret of at least 32 characters. The app shows setup instructions until the administrator credentials exist.

Uploads and downloads use the Worker's private R2 binding. **No S3 API keys, R2 account-ID variable or bucket CORS setup are required.** Keep the bucket private. The browser sends 16 MiB parts to Folvio, which streams each part directly into R2 without buffering it in JavaScript.

For local development, configure administrator credentials in an ignored `.dev.vars`, then run `npm run migrate` and `npm run dev`. Local R2 emulation supports the same upload path as production.

## Local development and checks

```sh
npm test
npm run build
npm run test:runtime
npm run test:browser
```

`npm ci` installs the locked dependencies. Browser tests use installed Chrome; set `CHROME_PATH` when it is not at the default macOS location.

`npm test` runs permission tests and API workflows with real SQLite and an R2 test double. `test:runtime` uses Miniflare and requires permission to bind localhost sockets. It must follow `npm run build`. `test:browser` exercises the real uploader and file manager in Chrome; staging additionally verifies the actual Cloudflare services.

See [API.md](API.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [ACCEPTANCE.md](ACCEPTANCE.md).

## Configuration

| Name | Type | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | Runtime secret | Administrator username |
| `ADMIN_PASSWORD` | Runtime secret | Strong, unique administrator password |
| `SESSION_SECRET` | Runtime secret | Recommended random signing secret, at least 32 characters |
| `STORAGE_LIMIT_BYTES` | Runtime variable | Installation quota, default 8,000,000,000 bytes |

| Binding | Resource | Configuration |
| --- | --- | --- |
| `DB` | D1 | `folvio-db`, with your database ID |
| `FILES` | R2 Standard | Private `folvio-files` bucket |
| `ASSETS` | Workers static assets | `public/` |

Set secrets under Worker **Settings → Variables and Secrets**, not build variables. The login page shows setup instructions until the administrator username and password exist. There is no default login or public registration.

## API

Create a key from **API keys** in the dashboard. It is shown once and grants full administrator access; keep it on your server.

```bash
curl https://YOUR-WORKER.workers.dev/api/collections \
  -H "Authorization: Bearer $FOLVIO_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"name":"Harbor Studio","create_folder":false}'
```

The response contains the collection `id` and public `token`. Share `https://YOUR-WORKER.workers.dev/s/TOKEN`. The [API reference](API.md) covers folders, permissions, cursor pagination and the multipart upload flow.

## Free-tier operation

Folvio requires Workers, D1 and R2 Standard. It does not require a paid Workers subscription, Queues, Durable Objects or an external authentication service. File contents stream through the Worker into R2, one bounded part at a time.

R2 has a free usage allowance, not unlimited free storage or a spending cap. Billing activation may be required, and storage or operations above the allowance may incur charges. The default 8 GB quota is an application limit, not an account-wide billing guarantee. See [architecture and costs](ARCHITECTURE.md) for allowances, monitoring, cleanup and practical limits.

## Security

See [SECURITY.md](SECURITY.md) for the security model, reporting guidance and known limitations.

- Administrator credentials are runtime secrets; sessions and API keys use hashed tokens in D1.
- Folder permissions are enforced by the Worker, including inherited restrictions and hidden ancestors.
- Each uploaded part requires a valid session/API key and checks current folder permissions, upload ownership, expiration and exact byte length.
- Recipients cannot move or delete folders, change permissions, or download other recipients' files.
- Uploaded files are not scanned for malware. Review files before opening them.

## Project layout

```text
src/                 Worker API, authorization and R2 signing
public/              Dashboard, recipient interface, styles and logo
migrations/          D1 schema migrations
tests/               SQLite/API tests and security tests
  runtime/           Cloudflare emulator tests
wrangler.jsonc       Worker, D1, R2 and scheduled cleanup configuration
```

## Updating and backups

Back up D1 and R2 before upgrading. Keep both: database metadata identifies each file's collection, folder and storage key. The Worker applies new migrations automatically on its first API request after an update. `npm run migrate:remote` is also available when the local config has a resolved D1 ID. Released migrations should never be edited. Read [CHANGELOG.md](CHANGELOG.md) for compatibility changes.

There is no built-in backup/export tool yet; it is tracked in [ROADMAP.md](ROADMAP.md).

## Sponsor

Folvio is free and MIT-licensed. If it helps your work, you can [sponsor its development on GitHub](https://github.com/sponsors/momardia54).

## License

[MIT](LICENSE). Login and dashboard patterns draw from Warden and the related projects; the existing copyright notices are retained.
