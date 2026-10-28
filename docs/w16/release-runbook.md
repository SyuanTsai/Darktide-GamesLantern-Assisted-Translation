# W16 package and release runbook

## Current status

This repository has a Windows-only production packager and a pinned W15 baseline. The current Web Store item ID, published version, contact and listing selections have not been verified here; no upload or submission is recorded. A code-version `0.2.31` ZIP candidate is ready. Before submitting, select the existing item and check its current version. If it is below `0.2.31`, this candidate version is eligible; if it is `0.2.31` or higher, rebuild with the next valid version above the actual listing. Do not create a new Store item or invent its ID or contact details.

The complete W16 package suite passed 5/5 on the fixed W15 baseline, including fresh-profile MV3 installation from the ZIP, offline baseline verification, and unknown-identity original-text preservation. Root's exact-ZIP acceptance also verified the six fixed HTTPS JSON GETs (no body, credentials omitted, redirects rejected) and the active IndexedDB snapshot. A separate legacy W10 UnitT21 may skip when its old approved-candidate environment variable is absent; that unrelated skip does not change the W16 result. The packaged runtime still has the W10/W11 native-identity guard and no production proof registry. The suite verifies safe behavior for an unknown item, not a positive live GamesLantern translation; this package must not be described as a complete translated experience.

The current candidate is `darktide-gameslantern-zh-tw-0.2.31.zip`, SHA-256 `e1b9f985b3c35d8c2ac176baf76fae1eaa3b9c6c751e0e50abbbdbb5666d3cda`; the adjacent `package-receipt.json` records the inventory and W15 identity. This ZIP and receipt are local build artifacts, not a Store upload or approval.

## Rebuild the package

Run from a clean Windows checkout with the repository's existing Node runtime and dependencies. Do not install or update packages for this procedure.

```powershell
npm run icons:w16:render
npm run test:w16:package
npm run package:w16:release -- --version 0.2.31 --output-dir <new-absolute-output-directory>
```

The output directory must not already exist and should be outside the repository. If the existing Store version is at least `0.2.31`, use the next valid version above the actual listing. For example, if the Store currently reports exactly `0.2.31`, rebuild with `--version 0.2.32`; if it reports another value, increment that verified value instead. The builder accepts one to four canonical integer components, each no greater than 65535, rejects leading zeros and the all-zero version, and does not determine whether the chosen version is newer than the Store listing.

Keep `package-receipt.json` with the ZIP outside the upload. Confirm its `extensionVersion`, W15 `contentVersion`, `buildId`, `dataRevision`, baseline pins, package file inventory and `archive.sha256`. The receipt is evidence for the local artifact; it does not mean Chrome reviewed, approved, or published it.

The ZIP must have `manifest.json` at its root. Extract it to a new directory and compare every file's raw bytes to the `unpacked` directory and receipt. The archive allowlist contains the shared runtime, W15 `version.json`, manifest and four core domains, the four PNG icons, and `PRIVACY.md`. It must not contain test harnesses, test registries, fixtures, developer baselines, `node_modules`, local paths, or private evidence. The optional Web announcements domain is not downloaded or required by this extension.

## Local installation and verification

Use a fresh Chrome profile or a dedicated test browser. In `chrome://extensions`, enable developer mode and load the extracted package directory. Confirm Chrome reports the packaged manifest version and that the background service worker starts. Review the reported permissions: the manifest declares no optional or ordinary permissions; it requests the fixed data host `https://darktide.tw-syuan.com/*` and injects only on the listed GamesLantern routes.

Before considering an artifact ready for review, verify:

- the extension-local W15 baseline files can be read and pass raw size, SHA-256, schema, release, and four-domain checks while the browser is offline;
- with network enabled, data requests are limited to the fixed data origin, use the fixed public JSON paths, omit credentials, and reject redirects;
- a page with no exact, approved native identity match keeps its original text and does not gain owned translation details;
- “切回原文” and disable restore the original page content;
- ZIP contents and receipt still match after extraction.

A successful build or baseline check does not verify a positive live GamesLantern identity match. Keep that result separate until there is fixed native evidence for the exact page and source tuple. Do not add test proof or a locally asserted identity to the production package.

## Chrome Web Store review checklist

The single purpose for the listing is: “Display reversible Traditional Chinese translations for verified Darktide game entries on supported GamesLantern pages.” Keep the listing and privacy answers limited to the implementation:

- no Chrome `permissions` entries or optional permissions;
- the fixed data-site host permission and the exact content-script matches shown in the generated manifest;
- local processing of supported page paths and native game-item fields for exact matching;
- public JSON retrieval from the fixed HTTPS data origin with credentials omitted;
- verified W15 baseline and snapshots stored locally in the extension's IndexedDB;
- no account, analytics SDK, advertising, form submission, or extension upload of page contents;
- ordinary network metadata may be visible to the data site and to GamesLantern for the user's direct site visit.

Use the packaged `PRIVACY.md` as the policy text when preparing the listing. Add the publicly reachable policy URL, developer contact method, current item ID, current Store version, selected privacy disclosures, screenshots, and final ZIP SHA to the review record after checking each value in the actual dashboard. This document does not assert that any dashboard choice was selected or submitted.

References: [Chrome Web Store preparation](https://developer.chrome.com/docs/webstore/prepare), [manifest version](https://developer.chrome.com/docs/extensions/reference/manifest/version), [manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons), [privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), and [Chrome Web Store User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

## Upgrade, failure, and recovery

For a Store update, first record the existing item's ID and version, then confirm the new code version is strictly greater. Retain the previous Store artifact identity and the new ZIP plus receipt SHA together. Submit through the verified existing item only after the package and listing have passed review; this runbook does not change the Store listing.

For a failed local verification, do not upload the artifact. Preserve its receipt and error output, rebuild into a new output directory after correcting the cause, and compare the new inventory and hash. For a failed published update, use only the controls currently available for the verified Store item and retain the affected version and resulting status; do not describe a rollback as successful until the dashboard confirms it. Users can disable or remove the extension in Chrome. Reinstalling or rolling back the code does not change the fixed Web data owner or select a different game-data snapshot.
