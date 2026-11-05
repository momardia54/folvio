# Acceptance results

Verified on 2026-11-04 using Node 22, Chrome, Miniflare and an isolated Cloudflare deployment.

## Passing checks

- Clean independent `npm ci`; dependency audit reports zero vulnerabilities.
- Production bundle builds; 17 in-process security/API/hardening tests pass.
- Cloudflare-emulator test passes with real local D1/R2, including streaming a part through the Worker.
- Chrome desktop (1440 px) and mobile (390 px) tests pass without horizontal overflow or page errors.
- Browser coverage: login, collection wizard, nested folders, rename/move/delete, recipient folder creation default/toggle, directory-scoped link, actual upload, file display/rename/move, theme switching, API-key creation/revocation and collection navigation.
- Live D1 migrations, authentication, collection/folder permissions and static security headers pass.
- Actual Chrome → Worker → R2 uploads pass: UI upload, 13-byte file and 105 MiB multipart file. Incorrect part sizes are rejected. Completion verifies size; files appear in the correct folder. Authenticated downloads and deletion pass.
- Directory links cannot list or upload into sibling folders, cannot disclose the collection-wide token, and stop working after revocation. Covered locally and on staging.
- The actual cleanup handler aborts an abandoned multipart upload and releases its D1 reservation against real D1/R2. A staging-only authenticated wrapper invoked the same handler; waiting for the hourly scheduler itself was not part of this test.
- The CLI deployment script was exercised against the staging resources: resource lookup, migrations, lifecycle configuration and deploy passed.

## CPU sample

Cloudflare analytics reported 131 successful requests with zero Worker errors: CPU p50 **3.258 ms**, p99 **9.409 ms**. Two intentionally interrupted download requests were classified as clientDisconnected, with zero Worker errors. These measurements include the staged upload workflows but are a small sample, not a load/capacity guarantee. Account subscription inspection was denied by the OAuth scope, so this does not independently certify the account's billing plan. The implementation uses no essential paid-only feature.

## Test isolation and cleanup

The Worker, D1 database and R2 bucket used the isolated name `folvio-verify-20261104` in the Development account. They were deleted after testing. Existing Warden/imghost resources were not changed. No administrator or storage credentials were saved in source or test artifacts.

The current architecture streams files through the Worker's R2 binding. S3 API credentials, presigned upload URLs and bucket CORS are no longer needed.

## Release work remaining

- Publish the repository, enable private vulnerability reporting and run the configured GitHub Actions workflow.
- Verify the Deploy button from that published repository on a fresh account. The CLI provisioning path is implemented; a fresh-account click-through is not claimed.
- Perform a broader accessibility/security review and longer workload testing if using this beyond modest personal/team workloads.

`tests/staging/worker.js` is verification-only. Production `wrangler.jsonc` points directly to `src/index.js` and does not expose the cleanup-test endpoint. To repeat staging tests, create an isolated staging config/resources, set FOLVIO_STAGING_ORIGIN if needed, and run `npm run test:staging`. The script creates ephemeral test login secrets, exercises transfers and removes uploaded test objects; resource deletion follows separately.

## Default deployment regression

A fresh `npx wrangler deploy` created the isolated D1 database and R2 bucket automatically with no database ID in its configuration. The first `/api/session` request returned 200 and all three migration records were confirmed in remote D1. The verification resources were deleted afterwards. Local tests also cover simultaneous first-request initialization and cold restart idempotence; browser/runtime tests start from empty databases.
