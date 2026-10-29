# W16 package and release runbook

## Current status

This repository has a Windows-only production packager and a pinned W15 baseline. The current Web Store item ID, published version, contact and listing selections have not been verified here; no upload or submission is recorded. The final `0.2.33` clean-index ZIP is at `F:\GitFile\Persion - Games\DarkTide-Web\.tmp\w16-startup-20261028\a02\upload-kit-0.2.33-ready\darktide-gameslantern-zh-tw-0.2.33.zip` with SHA-256 `2dfaa04cc3d6f2420855a49a1ac9dc49b5cdc2ef1f7115eb17d78966b7da77f9`. Before submitting, select the existing item and check its current version. If it is below `0.2.33`, this candidate version is eligible; if it is `0.2.33` or higher, rebuild with the next valid version above the actual listing. Do not create a new Store item or invent its ID or contact details.

The A01 W16 production package suite passed 7/7 on the fixed W15 baseline, including a fresh-profile MV3 ZIP install, raw baseline verification, and offline reads. Its controlled-DOM integration verifies exact Brain Rupture list/detail and chainaxe matches, original-text restoration, a changed-description rejection, and an unmatched lasgun remaining original. The W11 DOM suite passed 9/9, including the existing unselected-candidate compatibility case and native `href`/image `alt` identity changes that remain untranslated until the original identity returns. These captured-DOM results are not live GamesLantern page results.

A02 adds a separate, read-only blessing reference reader to the normal production package at `/weapon-blessing-traits`. It reads the already verified local W15 snapshot and lets the user select a blessing, variant and tier; its status explicitly identifies the local data version and says native blessing/tier applicability is unverified. The reader is shown inside the bottom-right controls popover, not as a claim that the current GamesLantern page identity was verified. It does not change native matching. A02 unit tests passed `10/10`; the normal-package and W11 MV3 reader regressions each passed `1/1`, including snapshot lifecycle, candidate native proof, selection, unknown applicability, disable/re-enable and a 390px viewport. The final deduplicated targeted suite passed `38/38` with no failures or skips.

The controls use a non-modal manual popover when supported, with the existing fixed-position fallback. The independent reader is nested inside that popover, with a bounded scroll area and viewport-constrained width. The focused production MV3 integration passed `1/1`: ordinary LV1/LV4 and restore/re-enable clicks worked at `1280x900` and `390x844` while a full-viewport, maximum-z-index overlay remained visible; the panel did not overflow, and no modal or focus trap was introduced. The test-only reader fixture uses a fixed candidate skill card because the legacy reader is shown only after the existing controller has actually applied a verified native record. Its test proof is not included in the production package and does not assert that the native blessing itself was identified.

The earlier A01 clean-index package `darktide-gameslantern-zh-tw-0.2.32.zip` (SHA-256 `cb79c83ca7c40a6fffdee4d272f0851632a862f74572053303e648bcb972d3ac`) remains historical evidence. The first A02 candidate `c9a183f2…` was superseded after a 390px ad overlay blocked ordinary reader clicks; it is not the upload candidate. The final `0.2.33` ZIP and paired receipt are the `2dfaa04c…` artifact listed above. Root's clean-index rebuild matched all `30/30` package files byte-for-byte. No Store upload or approval is recorded.

Root verified the final ZIP on the real GamesLantern `/weapon-blessing-traits` page: ordinary LV1/LV4 selection, restore and re-enable worked at desktop and 390px widths; native status remained original, and the six fixed JSON GETs carried no Cookie or Authorization. There was no routing mock, test proof, or extension error. The reader appeared inside the bottom-right controls popover and stayed within the viewport. Its existing conditions section expanded and scrolled at both widths; this snapshot has no terms section, so the live check makes no claim about the five-section/term content. The `/abilities` page was blocked by HTTP 403 for this ZIP; live detail and weapon routes were not retried. Earlier A01 `/abilities` evidence belongs to `0.2.32` only. Positive detail and weapon behavior remains supported by controlled-DOM MV3 fixtures, not claimed as live-verified. The extension's dataset does not prove the whole GamesLantern site version.

## Rebuild the package

Run from a clean Windows checkout with the repository's existing Node runtime and dependencies. Do not install or update packages for this procedure.

```powershell
npm run icons:w16:render
npm run test:w16:package
npm run package:w16:release -- --version 0.2.33 --output-dir <new-absolute-output-directory>
```

The output directory must not already exist and should be outside the repository. If the existing Store version is at least `0.2.33`, use the next valid version above the actual listing. The builder accepts one to four canonical integer components, each no greater than 65535, rejects leading zeros and the all-zero version, and does not determine whether the chosen version is newer than the Store listing.

Keep `package-receipt.json` with the ZIP outside the upload. Confirm its `extensionVersion`, W15 `contentVersion`, `buildId`, `dataRevision`, baseline pins, package file inventory and `archive.sha256`. The receipt is evidence for the local artifact; it does not mean Chrome reviewed, approved, or published it.

The ZIP must have `manifest.json` at its root. Extract it to a new directory and compare every file's raw bytes to the `unpacked` directory and receipt. The archive allowlist contains the shared runtime, W15 `version.json`, manifest and four core domains, the four PNG icons, and `PRIVACY.md`. It must not contain test harnesses, test registries, fixtures, developer baselines, `node_modules`, local paths, or private evidence. The optional Web announcements domain is not downloaded or required by this extension.

## Local installation and verification

Use a fresh Chrome profile or a dedicated test browser. In `chrome://extensions`, enable developer mode and load the extracted package directory. Confirm Chrome reports the packaged manifest version and that the background service worker starts. Review the reported permissions: the manifest declares no optional or ordinary permissions; it requests the fixed data host `https://darktide.tw-syuan.com/*` and injects only on the listed GamesLantern routes.

Before considering an artifact ready for review, verify:

- the extension-local W15 baseline files can be read and pass raw size, SHA-256, schema, release, and four-domain checks while the browser is offline;
- with network enabled, data requests are limited to the fixed data origin, use the fixed public JSON paths, omit credentials, and reject redirects;
- a page with no exact, approved native identity match keeps its original text and does not gain owned translation details;
- the blessing reference reader, if used, is labelled as local W15 data and does not mark the native page as translated or claim that blessing/tier applicability was verified;
- “切回原文” and disable restore the original page content;
- ZIP contents and receipt still match after extraction.

A successful build or captured-DOM integration does not establish live behavior for every supported route. The final `0.2.33` ZIP's `/abilities` request returned HTTP 403; the earlier A01 live result was limited to one observed Brain Rupture item on ZIP `0.2.32`. Detail and weapon live routes remain unverified. Do not add test proof or a locally asserted identity to the production package.

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
