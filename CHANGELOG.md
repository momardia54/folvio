# Changelog

All notable changes to Folvio, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

Folvio is pre-1.0. Minor versions may change the API or data model; compatibility changes will be listed under **Changed** or **Removed**, with migration guidance. See [ROADMAP.md](ROADMAP.md).

## 0.1.0 — Unreleased

Initial pre-release implementation, verified locally and on isolated Cloudflare staging. Not yet published as a release.

### Added

- Single-administrator login using Worker runtime secrets, server-side sessions, logout and login throttling.
- Responsive dashboard with light/dark themes and collection, file and API key management.
- Five-step collection wizard: details, upload limits, nested folder tree, recipient permissions and sharing.
- Stable random collection links, optional passwords, expiration and storage/file-size limits.
- Administrator folder creation, rename, move and deletion of empty folders.
- Collection-level upload, folder creation and own-folder rename permissions, with folder overrides and hidden subtrees.
- Recipient folder creation disabled by default; permissions enforced server-side for UI and API requests.
- Worker-streamed multipart uploads with exact part-length checks, atomic storage reservations and completion size verification.
- Bounded hourly cleanup for abandoned uploads and expired authentication records.
- Administrator file downloads and deletion; recipient listing limited to their own uploads.
- Revocable, hashed administrator API keys and a documented JSON API.
- SQLite/API tests, security tests and a separate Cloudflare emulator test.
- Deployment instructions, free-tier architecture notes and acceptance checklist.
- Project README, logo, Deploy to Cloudflare link, roadmap and security policy matching the related projects' documentation style.

### Changed

- Uploads and downloads now stream through the Worker using its R2 binding. Removed S3 credentials, presigned URLs and R2 CORS setup.
- Added automatic CLI resource provisioning and migrations.
- Added grid/list file management, small raster previews, rename/move/delete controls and directory-scoped upload links (migration 0003).

### Fixed

- Fix Cloudflare default deployments failing with error 10021: remove the placeholder D1 ID, use native resource provisioning, and apply bundled schema migrations automatically through the Worker binding. `npx wrangler deploy` now works without a custom deploy command. Verified on fresh Cloudflare D1/R2 resources.

- Reject non-object JSON bodies and malformed multipart entries with client errors.
- Track collection revisions so concurrent folder permission edits and moves cannot overwrite a stale snapshot. Migration `0002_collection_revisions.sql` is required.
- Enforce the folder count limit inside the insert statement.
- Prevent upload cancellation from deleting a file while completion is in progress.
- Correct collection sidebar navigation and retain upload destination throughout transfer.
- Add static-asset security headers and GitHub Actions checks.

### Verification status

- All 15 in-process tests pass with SQLite and an R2 test double; includes concurrency, isolation, cleanup failures, body limits and throttling.
- Wrangler dry-run build passes.
- Cloudflare emulator and desktop/mobile browser workflows pass. Remote authentication, folders and security headers pass on isolated staging; real Worker-streamed R2 transfers, scoped links and the cleanup handler pass. See ACCEPTANCE.md for the validation scope.
- Clean locked dependency installation and audit pass with zero reported vulnerabilities.
- Fixed the ETag-length bound exposed by real emulator multipart uploads.
- The Deploy button targets the intended `momardia54/folvio` repository; publication and fresh-account installation are not verified.
