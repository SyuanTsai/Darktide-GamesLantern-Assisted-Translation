# W10 實作計畫｜SYP-342

## 1. 目標與範圍

本包落實 SYP-311 v17 的 R04／R09 與 W10：Extension 以本地程式取得同一套 shared JSON，按當頁已識別的遊戲 patch／snapshot 選取版本，驗完整依賴後存入 extension-origin IndexedDB，完整交易完成才換 active。更新失敗保留前版；一個 document 固定一組 contentVersion／dataRevision，新 document 或使用者重整才採新資料。

適用規格：[v17-D／11649](https://syuantsai.atlassian.net/browse/SYP-311?focusedCommentId=11649)、[v17-C／11581](https://syuantsai.atlassian.net/browse/SYP-311?focusedCommentId=11581)、[v17-F／11689](https://syuantsai.atlassian.net/browse/SYP-311?focusedCommentId=11689)。W01–W09 工程均已完成；W10 不重開它們。

交付本地正式 loader／matcher／store／document-session 模組、隔離 MV3 build、最小單元與真 IDB／extension 故障驗證、W01 沿用清單、固定資料 bytes／hash 與回復紀錄。W11 才整合真網站 DOM、五節 UI、原文還原與 native events；本包不把測試頁冒充 W11 完成。

不合併 PR15 或任何 main、不 selected、不保留／分配正式 contentVersion、不正式網站發布、不 production rollback、不再公開新 Source archive。不進 W11／W12／W13 或全量遷移，不動 Private／Mods，不新增遠端可執行程式、任意 URL 設定、framework、token 或審核閘門。SYP 不記工時。

## 2. 已核實輸入與可沿用內容

| 對象 | 固定身分與事實 |
| --- | --- |
| Extension remote main／W10 base | `3e5a46b51a0aac87b6d714d49d173bec1c1a866c`；tree `c3ee9c7b428053e52820305a14e1f848ade59424`，與 W01 `5a09f3628208550cca8696655f3012c23c53d5e5` 完全相同 |
| 原 Extension 工作區 | `b18f5ee2d7c9886b1d9ecb56f7ece8fca5d32c9a`／main，5 個 dirty review JSON，無 index.lock；保留原樣 |
| W10 隔離 checkout | `F:/GitFile/Persion - Games/DarkTide-Web/.tmp/w10-startup-20261023/Extension`，branch `codex/SYP-342-w10-shared-loader`；不改 W01 驗證 clone |
| Web main／Source main | `0d2e2a3cfb00dcd5856a6832e18835eb8df227a6`／`d4fb3de95d5d695358f5dc36747cdb502e2b3ab5` |
| 已批准但未選取候選 | PR15 `b4b11ec055adad42bb6732f833946886446e89cd`；869 targets approved、874 receipts；CI39790859908：533 pass／0 fail／15 skip |
| Source 固定輸入 | commit `fccda635f392b5259c883b85603acdf639bb83fb`；archive SHA256 `5ffd4bf8a15803a1c319a94114f43f8ca3350dfcb18c13dc6e8557a48fcf8603`；既有 archive 不變 |
| 離線新候選 | dataRevision `808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62`；manifest SHA256 `bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7`；contentVersion `1.13.2.1` 仍只提案值 |

可沿用 `extension/w01/loader-core.js` 的固定 origin、安全 fetch、SHA256、JSON 純資料拒絕與 IDB 完整交易經驗；`extension/w01/service-worker.js` 的 sender guard；`scripts/w01/build-dev-extension.cjs` 的私有 temp MV3 build；`tests/w01/playwright-runtime.cjs` 的現有 Playwright 解析。`browser-extension.cjs` 寫死 W01 Extension 名稱，W10 只沿用其辨識方式，不能直接用原函式把未載入的 W10 誤列 Skip。不是複製 W01 通過結果當作 W10 驗收。

真正差異：W01 只接受 fixture／pending-preview，manifest 強制舊五域、`skills.json` 等根目錄檔及非 null game-changes；W08/W09 是四核心域、`domains/*.json`、`changeIndexPath:null`、`w08-shared-domain/1.0.0` 與域內 Source/Web registries。W01 每檔 2 MiB／整包 6 MiB，現武器域為 6,662,191 bytes，四域總共 7,065,789 bytes，不能直接套舊上限。

Web 現有 `scripts/content/contract-release.mjs` 的 `validateVersion`／`validateManifest`／`computeDataRevision`／`selectGameRelease`／`selectConsumerFiles`，以及 `contract-w08-build.mjs` 的 `validateDomainDocument` 是正式契約依據。新增瀏覽器 validator 只消費並驗證，不成為第二個 compiler 或內容 owner。

## 3. 最小實作切片與可改路徑

以下為新模組的預定落點，尚非已完成檔案。必要實作依序完成；發現跨範圍差異先補本計畫，不順手修改 Web／Source 資料。

### 3.1 shared 契約與 patch matcher

- 新增 `extension/shared/contract.js`、`extension/shared/loader.js`；沿既有 CJS／browser global dual export 慣例，不引進套件。
- 驗 version schema 2、published 指標結構、manifest exact keys、Source repository／commits、major／features、canonical dataRevision、同 origin 的不可變路徑及依賴 DAG。支援必要 kinds 的閉包，不硬規定額外公告／game-change 必須存在，也不接受未支援的必需依賴。
- 精確匹配可信本地 adapter 提供的 gameVersion／gameReleaseId／已識別 snapshot；無法判明、相互矛盾或不相容就回傳原站狀態，不能選全站最大版本。有效較舊指標可作合法回復，不能以數字遞增規則擋掉。
- 固定下載 origin 來自本地 build 設定：正式為既有 `https://darktide.tw-syuan.com`，隔離 build 只用既有 preview origin。message、遠端 JSON、網頁不能指定 URL／改 origin；驗 redirect／最終 URL、HTTP、JSON MIME、UTF-8、大小、SHA256。
- 初始可測上限：version 64 KiB、manifest 256 KiB、單域 8 MiB、快照 16 MiB。由目前實際四域大小支持，加入邊界測試；W13 才按更完整代表集調校，不申請 unlimitedStorage。
- `w08-shared-domain/1.0.0` 驗 top-level 身分、Source/Web registries、typed references／sourceRefs／official input closure、資料 shape 及 required features。資料保留原 bytes；禁止 JS/WASM／HTML template／selector 程序／公式執行／任意遠端 URL，不把合法來源定位的純 metadata 當成下載指令。

### 3.2 IDB staging 與原子 active

- 新增 `extension/shared/snapshot-store.js`。採獨立正式 DB namespace，保留 W01 DB，不將舊 preview 包自動當正式 active。
- 全部網路與 crypto 驗證在交易前完成；staging 僅表示未啟用候選。完整快照、active 指標及目前／上一相容版本保留在同一受保護交易中切換，不在 IDB transaction 中等待 fetch／digest。
- activation 以持久 check generation／期望 active 比對防止舊請求覆蓋較新已完成檢查；SW 重啟、兩頁競爭、transaction abort、quota 不得留下半包 active。
- cache 每次使用重新驗原始 manifest／domain bytes；eviction、損毀與缺檔後依相容 cache→同 shared 原檔 baseline→原站處理。baseline 不重編、不手改欄位，也不把未發行候選標成已正式發行。

### 3.3 背景協調與 document 固定版本

- 新增 `extension/shared/service-worker.js`、`extension/shared/document-session.js`。跨頁相同 release 的 in-flight 檢查合併；首次活動、距上次成功檢查滿 24 小時及手動才查小版本檔，失敗有限退避，不建立常駐輪詢。
- 依現有 sender guard 與固定 allowlist 驗 Extension 身分及本地 adapter 呼叫；不接受網頁任意 URL 或程式。真網站 DOM 辨識及 UI 接線仍留 W11。
- document 第一次初始化的 promise 固定快照；同文件 SPA 操作不熱換新版、不強刷頁面。patch 變得不相容時停止該組翻譯；新文件才重新選目前完整快照。

### 3.4 封裝與固定資料驗證

- 新增 `scripts/shared/build-dev-extension.cjs`，沿用既有私有 temp 輸出及 sender／CSP 邊界。僅打包本地程式；host_permissions 為固定必要 origin，不加入任意設定欄位。
- 新增 `tests/w10/` 的現有 node:test／Chromium 測試與 `docs/W10_DELIVERY.md`；只為本包增加必要 package scripts。現有 package 沒有 lockfile，使用已安裝 Playwright／Chromium，不為計畫或測試自動升級／安裝套件。
- 對 PR15 離線候選驗相同 manifest／四域 bytes、hash、資料版。測試用 version pointer 或測試封裝必須明標 isolation-only，不寫 selected／正式 source-handoff locks、不發布、不冒稱分配 `1.13.2.1`。目前沒有已發布此候選的正式 version 指標，不偽造正式 HTTPS rollout。

## 4. 測試與 TDD 順序

遵守既有 node:test、固定兩位數前綴、每項 Scenario／Purpose／Given–When–Then；先 Red 再最小 Green，測試不依賴執行順序。

| 切片／C 對應 | 最小 Red 與必要 Then |
| --- | --- |
| `tests/w10/contract.test.cjs`／UnitT14、17 | 同一 version 有不同 game patch，指定 patch 選到精確 manifest；合法回復較小 contentVersion 仍接受；未知 snapshot／錯 patch／缺必要 kind／缺依賴／cycle／canonical digest 錯／未知 feature 必拒絕 |
| `tests/w10/loader.test.cjs`／UnitT14、16 | 錯 hash／MIME／HTTP／UTF-8／超限／redirect／unsafe path／HTML／可執行欄位，不進 commitSnapshot；原 active 不變；安全 Source metadata 不觸發額外請求 |
| `tests/w10/store.test.cjs` 與 `idb-integration.test.cjs`／UnitT15 | 完整 R1→中止／quota／缺檔 R2→仍 R1；成功 R2 原子生效；兩競爭檢查以持久 generation 防過期覆寫；真 Chromium IDB／SW 重啟驗快照可恢復 |
| `tests/w10/session.test.cjs`／InterT04 | 一個 document 先取得 R1，背景完成 R2 仍保持 R1；新 document 取得 R2；未知／變更 patch 回原站，不混 domain |
| `tests/w10/fallback-integration.test.cjs`／InterT05 | 首次離線、cache 離線、timeout／404／challenge／半包；相容 cache／baseline 可用，皆不可用才原站；不報假成功 |
| 真批准候選／R04 | 本地受控通路讀取既有候選相同四域 bytes／hash，不手改真內容、不靠 synthetic receipts；這是隔離候選證據，與未執行正式發布區分 |

第一個 Red：`UnitT10_SelectExactPatchAndAllowValidOlderPointer`，由新增正式 matcher 無法處理 W08 形狀而失敗；Green 只補契約／選取，不先寫 renderer 或大包網路邏輯。隨後補 hash／缺依賴拒絕，再進 store 與 background。

配置／build manifest 的最小必要改動免 test-first，但必須驗固定 host_permissions、CSP、檔案清單、沒有遠端 script、沒有憑證／私人材料。既有 W01 沒改的模組保留歷史有效證據；只在新依賴或實際疑點需要時跑受影響回歸。

## 5. 交付、相容與回復

僅在隔離 branch 交付固定 commits／必要 draft PR，不合併。分清 code head、測試資料 origin、candidate manifest dataRevision、原始 bytes/hash、真 IDB 與 stub store 各自證據。沒有正式 rollout 或商店結果就不宣稱已驗。

新 DB 與 W01 preview 隔離；回復本包程式使用一般 revert 或停用隔離 build，保留原快照與使用者修改，不 reset／clean。資料失敗只丟棄未啟用 staging，原 active／上一相容版仍可驗；正式組合回復仍由 W09 的既有流程及另外授權處理。

成功訊號：錯包不改 active、當前 document 不換版、新 document 只見完整相容包；固定真輸入 hash 不變；原五份 dirty 文件及 Web／Source main、PR15 head、正式網站版本均未改。

## 6. 執行角色與未解項

本對話 session metadata 已核實為 `gpt-6.1-sol`／`xhigh`，不假稱為其他 effort。v17 第7.3節仍載「後續實作／必要測試／finding修正仍依使用者指定Luna/Max，寫入前核實，不能自行換模型」。使用者已明確回答「授權單一 Luna／Max 實作者」；Root已在寫入前讀取子 session `01a16492-b596-7581-808f-dcf1da405e4c` 的實際 session_meta／turn_context，核實 `/root/w10_implementation` 為 `gpt-6-luna`／`max`，記錄在上一層 `implementer-runtime-evidence.json`。本計畫、Jira／Git及 Find／Review 仍由目前 owner 處理；單一實作者只寫授權切片，不操作 Git 或另增 writer。

固定 shared 契約與工程驗證已有可用輸入，沒有 token／發布權限缺口阻止本計畫的獨立工程工作。正式候選尚未 selected／配號／發布的事實保留，不把它變成開始 matcher／loader／IDB 隔離測試的新人工門檻。

## 7. 已核對的公開 API 依據

- [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：worker 終止會失去 globals，重要 active／檢查世代資訊必須持久保存，另驗重啟恢復。
- [MDN IDBTransaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction)：交易在特定 event-loop task 才 active，沒有後續 request 可自動提交；因此網路與 crypto 在切換交易之前完成，故障以 abort／complete 事件判定。
- [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)：背景與 content script 的跨 origin 邊界不同；host_permissions 與本地 sender／URL 限制均需驗，不讓呼叫者自訂遠端 URL。
