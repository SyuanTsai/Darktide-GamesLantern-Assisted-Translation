# SYP-389 spec1 驗證與交付紀錄

## 範圍

完成新契約驗證、固定路徑 loader、新 IDB scope 與原子啟用、6h coordinator、worker/client raw bytes 複驗、文件固定快照、dev/production 建置與 fixture 測試。`content-entry.js` 僅調整 client 呼叫參數；未修改 spec2 指定的六個顯示模組。所有測試資料來自 fixture／本機 HTTP，未對正式網站或 GamesLantern 發請求，未安裝套件、未 push。

## 驗證

- `node --test --test-concurrency=1 tests/w10/*.test.cjs`：28 個測試，26 通過、0 失敗、2 跳過。
- `npm run test:w10`：26 通過、0 失敗；IDB／MV3 各 1 跳過。底層指令：
  - `node --test-concurrency=1 --test tests/w10/source-data-contract.test.cjs tests/w10/source-data-loader.test.cjs tests/w10/source-data-store-update.test.cjs tests/w10/source-data-message-session.test.cjs tests/w10/build.test.cjs`
  - `node --test-concurrency=1 --test tests/w10/idb-integration.test.cjs`
  - `node --test-concurrency=1 --test tests/w10/mv3-integration.test.cjs`
- 瀏覽器跳過原因：`W10 Playwright is unavailable from explicit, repository-local, or optional runtime paths`。未下載 Playwright／Chromium，實際瀏覽器行為尚未驗證；unit 使用具有非同步請求、序列交易與 abort rollback 的記憶體 IDB 替身。
- production ZIP 測試已使用 `pwsh` 離線產生 ZIP，確認固定 host permission、CSP、top frame、模組清單與無 baseline；dev 保留固定 preview origin。產物只寫入本 worktree 的 ignored `.cache/`。
- 五個 fixture 逐一與 Source-Data `1396e47` Git blob 比較：全部位元組相同。
- `git diff --check`：通過。
- `git grep -n -E '/version.json|manifest_sha256|release-baseline|baseline-provider|powershell.exe' -- extension/shared scripts/shared scripts/release`：無命中（exit 1 為無結果）。

## W11／W16 既有測試結果（spec2 待處理）

`node --test --test-concurrency=1 tests/w11/build.test.cjs tests/w11/content-entry.test.cjs tests/w11/message.test.cjs tests/w11/native-identity.test.cjs tests/w11/presentation.test.cjs`：12 通過、2 失敗、2 跳過。

| 失敗測試 | 原因 |
| --- | --- |
| build / UnitT10_DevManifestLoadsOnlyLocalW11ContentModulesOnSupportedGameRoutes | 仍期待舊模組清單；finally 的舊系統 temp 清理檢查也不接受 worktree 內建置路徑，最終回報 Refusing to remove a build outside the private W10 root |
| message / UnitT10_MessageHandlerAcceptsOnlyLocalExtensionOrTrustedTopFrameRoute | 仍送 trusted identity 舊訊息，現行契約拒絕多餘欄位 |

兩個 presentation 測試因未提供舊 `SYP_W10_APPROVED_PACKAGE_DIR` candidate 而跳過。

`node --test --test-concurrency=1 tests/w11/dom-integration.test.cjs tests/w11/mv3-integration.test.cjs`：0 通過、9 失敗、2 跳過。

| 失敗測試 | 原因 |
| --- | --- |
| dom / InterT10_VerifiedCandidateAndSyntheticProofPreserveNativeDOMAndRestoreSafely | 缺舊 candidate |
| dom / InterT20_PatchChangeDuringDelayedInitializationNeverAppliesStaleView | 缺舊 candidate |
| dom / InterT25_ChangedNativeHrefAndImageIdentityStayOriginalUntilRestored | 缺舊 candidate |
| dom / InterT30_ExactErrataStaysVisibleBeforeCollapsedDetails | 缺 Playwright |
| dom / InterT40_EditableLookalikeCardsRemainUntouched | 缺舊 candidate |
| dom / InterT50_KnownAbilityCardInsideEditorPopupRemainsMatchable | 缺舊 candidate |
| dom / InterT70_ExactWeaponRouteAndNativeHeaderBindOneWholeMarkView | 缺舊 candidate |
| dom / InterT80_WeaponOfficialAndExactErrataPrecedeCollapsedDetails | 缺舊 candidate |
| mv3 / InterT20_NormalBuildHasNoTestProofAndLeavesUnknownNativeFactsUntouched | finally 的舊 temp 清理檢查不接受 worktree 內建置路徑（環境另缺 Playwright） |

dom InterT90 與 mv3 InterT10 因缺舊 candidate 跳過。

`node --test --test-concurrency=1 tests/w16/production-dataset.test.cjs tests/w16/production-package.test.cjs`：兩個檔案皆載入失敗。

| 失敗檔案 | 原因 |
| --- | --- |
| production-dataset.test.cjs | 仍 require 已退役 `extension/shared/contract.js`；另有舊 baseline dependency |
| production-package.test.cjs | 仍 require 已刪除 `scripts/release/release-baseline.cjs` |

spec2 應改寫顯示 consumer／native identity／production pin 與相應 W11/W16 fixture 測試，處理 name.zh／official 為 null 不覆寫。本輪新 W10 production 建置測試已替代舊封裝假設；沒有為了舊測試恢復 baseline 或更動顯示邏輯。

## 刪除／取代清單

程式與資料：

- `extension/shared/{contract.js,domains.js}`：未再使用的 W08 契約，由 `source-data-contract.js` 取代；安全 patterns 已複製並註明來源。
- `extension/shared/baseline-provider.js`
- `extension/release-baseline/w15/version.json`（該目錄唯一 tracked 檔案）
- `scripts/release/release-baseline.cjs`

測試：

- `tests/w10/{contract,domains,loader,message,session,store,update-coordinator}.test.cjs`：由四個 source-data 測試檔取代。
- `tests/w10/idb-harness.{html,js}`：由自含本機 HTTP 的 IDB integration 測試取代。
- 原 build／idb-integration／mv3-integration 與 MV3 harness 原地更新。

舊 W10 fixture helpers 仍供 W11 測試引用，保留供 spec2 遷移。舊 IndexedDB 未讀寫、未刪除。
