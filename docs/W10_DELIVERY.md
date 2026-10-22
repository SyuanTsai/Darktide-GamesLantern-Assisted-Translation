# W10 工程交付｜SYP-342

2026-10-23：W10 工程候選與隔離故障驗收完成。固定程式 commit `8e8b8630c703968076fd6db6d65472117d7b203b`；Root 原 checkout 與獨立 Windows clean clone 均為 **52 pass／0 fail／0 skip**。本文件是工程交付收據，公開正式通路仍維持原狀。

## 範圍與行為

Extension 直接讀取 Web shared JSON 的原始 bytes，按可信本地 gameVersion／gameReleaseId／可選 snapshotId 選取相容版本。固定來源、manifest／檔案 hash、大小、UTF-8、schema、refs、features 及依賴閉包均通過後，才以 IndexedDB staging＋原子交易啟用。每條 game release 各保留目前與上一相容快照，檢查世代與 expected-active CAS 阻止慢請求覆寫新結果。

首次活動、距上次成功滿 24 小時或手動才檢查；不活動就不輪詢。相同指標只讀小 version 檔；不同才下載需要的四核心閉包。失敗退避依序 5 分鐘、30 分鐘、2 小時，之後上限 6 小時，每次仍由活動或手動觸發。失敗不啟用半包，依已驗 cache→同 shared 原檔 baseline→原站處理。

一個 document 固定第一次取得的快照，SPA／背景資料更新不熱換、不強刷；新 document 才重新選資料。身分改變或未知時回到原站。真 Games Lantern DOM、五節 UI、native events 與原文 restore 屬 W11，尚未在本包宣告完成。

## 固定輸入

| 對象 | 固定身分 |
| --- | --- |
| Extension base | `3e5a46b51a0aac87b6d714d49d173bec1c1a866c`，與 W01 tree 相同 |
| Phase 1／2／3／4 | `5db3bed07f9cb0b97ade66fad4f9aeadcba7bf35`／`91fb83a05cc3f7e1ca6062c1d82fb5a5b97ebd5c`／`68116880f57b222399aefaaa920c67871ee866a7`／`88e31d45d08636719aacfa96f30c2a02c71cff4e` |
| Phase 5／完整程式 | `8e8b8630c703968076fd6db6d65472117d7b203b`；後續交付文件 commit 不改程式 |
| Web PR15 內容 | `b4b11ec055adad42bb6732f833946886446e89cd`，869 approved targets／874 receipts |
| 候選 dataRevision | `808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62` |
| 原始 manifest SHA256 | `bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7` |
| 必要原始四域 | skills 165,051、blessings 113,990、weapons 6,662,191、terms 124,557 bytes；合計 7,065,789 |

候選尚未 selected、保留或配號；`1.13.2.1` 只沿用提案值。測試 pointer 與 dev baseline 的 provenance 必須清楚標示 isolation-only，不能當作正式 release receipt。Extension Git 不複製候選七 MB 遊戲內容成為第二個 owner。

| 原始檔 | bytes | SHA-256 |
| --- | ---: | --- |
| domains/skills.json | 165051 | `108628d9c9262541bd95741fcc0ef52b08ff874d02ce11eb0684bb52ef6da449` |
| domains/blessings.json | 113990 | `3e72d21be03b7beb966558665b7a4eb3fb389ea23fab8cf7c1cf722a409b22b5` |
| domains/weapons.json | 6662191 | `17a554bfc2a4a444b8e4cf89de64e698182deb1936ccebebd10f37f64c4f617a` |
| domains/terms.json | 124557 | `602cb6aca68e6add34aaa8eb0552efbba66324a97e7c4fbc406f03c0932b78f6` |

## 已核實的驗證

- Phase 1：Root 獨立短路徑 Windows clone 10 pass／0 fail／0 skip。
- Phase 2：Root 23 pass／0 fail／0 skip；另以真批准候選 manifest＋四域原始 bytes 驗 hash／refs／patch。
- Phase 3：Root 與獨立 Windows clean clone 各 27 pass／0 fail／0 skip；真 Chromium IDB 驗中止、跨版本競爭、損毀、缺檔、重開與上一相容快照。受控 transaction abort 不冒稱真磁碟 quota 耗盡。
- Phase 4：Root 40 unit＋2 IDB integration，0 fail／0 skip；純單元不要求 browser。實際 runtime：Node 24.19.0、Playwright 1.64.0、Chromium 156.0.8078.4；沒有安裝或升級套件。
- Phase 5：同一實作者 `npm run test:w10` 52 pass；Root 使用既有 Node 直接執行全部 10 個測試檔，52 pass。包含 46 unit、2 IDB integration、4 MV3 integration，全部 0 fail／0 skip。
- 固定 `8e8b863…` 的獨立 Windows 短路徑 clone 再驗 52 pass／0 fail／0 skip；測試前後 Git clean，manifest fixture SHA 均為 `bf655afe…`。不需要 task sibling runtime JSON；browser runtime 及批准候選原檔目錄由環境變數明確指定。
- 同一 clean clone 執行 build CLI 成功，預設不含 test harness；固定 preview host permission、local CSP、九個本地程式與所有批准 domain 原檔 hash 均符合預期。

本機完整執行紀錄保存在 W10 隔離 checkout 上一層：`phase5-root-full.log`、`phase5-clean-clone-full.log`、`phase5-clean-clone-receipt.json`、`phase5-root-build-entry.json`、`phase5-review-result.json`。這些是本機工程收據；repository 沒有 tracked CI workflow，本包不聲稱遠端 CI 已通過。

重跑時沿用既有 Node／Playwright／Chromium，明確設定 `SYP_W10_PLAYWRIGHT_ROOT`、`SYP_W10_CHROMIUM_EXE` 及可選 `SYP_W10_APPROVED_PACKAGE_DIR`。最後一項指定固定批准 manifest 與四域原檔所在目錄；未設定時兩個真候選 MV3 案例與一個 build 案例會 skip，不能稱為本次完整 52 項驗收。

```powershell
# node.exe 解析到已存在的 Node 24；也可指定其絕對路徑，無需安裝。
$taskNode = (Get-Command node.exe).Source
$taskTests = @(Get-ChildItem -LiteralPath 'tests/w10' -Filter '*.test.cjs' |
  Sort-Object Name | ForEach-Object FullName)
& $taskNode --test-concurrency=1 --test @taskTests
& $taskNode scripts/shared/build-dev-extension.cjs
# 同等分組入口：npm run test:w10
```

## 需求與實際證據對照

| v17 要求 | 正式化位置與本次證據 |
| --- | --- |
| R04／UnitT14、17：精確 patch、snapshot、依賴與合法回復 | `contract.js`、`domains.js`、`loader.js`；contract／domains／loader tests 驗錯 hash、錯 patch、未知 snapshot、缺 kind／依賴、cycle、feature、合法較小 contentVersion |
| UnitT16：純 JSON 與固定下載邊界 | loader tests 驗 HTTP／MIME／UTF-8／redirect／path／串流大小／取消／timeout；固定正式 origin，隔離 build 才替換固定 preview origin |
| UnitT15：staging、完整交易、相容 cache 與競爭 | `snapshot-store.js`；InterT10 真 Chromium IDB 驗交易中止、缺檔／損毀、staging 污染、跨 release 分區、可選 snapshot、世代競爭、重開恢復 |
| R09：活動 24h／手動、有限退避、worker 生命週期 | `update-coordinator.js`、`service-worker.js`；coordinator unit 與 InterT30 驗請求合併、持久排程、失敗退避及實際 worker 終止後恢復 |
| InterT04：同 document 固定、新 document 採新版 | `document-session.js`、`client.js`；session unit 與 InterT30 真 MV3 R1→失敗 R2→成功 R2，程式 build hash 不變；舊文件仍 R1、新文件 R2，未知／變更身分回原站 |
| InterT05：cache→baseline→原站 | coordinator unit、InterT05 首次斷線無 baseline 回原站、InterT40 真批准原檔離線 baseline；後者不寫 active／lastSuccess |
| R04：相同 shared 原始四域 | InterT50 以固定 preview URL 的隔離 route 下載 version＋manifest＋四域，真 IDB 啟用，再經 Chrome JSON message 於呼叫端複驗所有 bytes／hash；沒有另建 compiler 或重新編輯內容 |
| 最小權限與可攜封裝 | build／message unit、InterT20；無新增套件、任意 URL、外部可執行程式或新權限；runtime baseline 不要求 dev provenance sidecar |

W01 的固定 origin、安全 fetch、SHA、純資料拒絕、sender guard、私有 temp build 與 IDB 交易方法已正式化到 `extension/shared/`，適配 W08 schema、四核心域、nullable changeIndexPath 與較大的真實 weapons。W01 舊 preview 模組、DB 與既有測試檔保留；本次驗收使用新的 W10 模組與真 worker，不將舊 POC 通過數併入 52 項。

## 覆核修正與驗證方法

Root 關閉可攜 fixture、同 patch 回復覆蓋、未需額外 manifest 檔相容、MIME charset 空白、跨 game line 快取驅逐、可選 snapshotId、staging raw 信任邊界、外部 runtime 記錄依賴、跨頁 in-flight 競爭及 timeout 測試未啟動真請求等問題。必要修正均由同一位已授權 `gpt-6-luna`／`max` 實作者完成；Root 寫入前讀實際 session metadata，負責 Git、Jira 與獨立覆核。

Phase 5 另修正真 weapons 大小導致 base64 重複正則溢位，改用有界線性檢查；取消 build 對 task sibling input-lock 及 runtime baseline 對 dev provenance 的不必要依賴。三項皆有針對性覆驗，完整真候選 MV3 路徑亦通過。Root 實際為 `gpt-6.1-sol`／`xhigh`，未假稱其他模型或 effort；沒有新增實作者。

Phase 4 有 test-first 流程偏差：loader 未保留 pre-implementation Red 執行收據，coordinator／session 首版程式先於測試。早期失敗保留而未冒稱先測後寫；必要行為與故障測試已完成，Root 獨立補驗。沒有倒造 Red，也沒有加人工批准門檻。

附帶 W01 廣回歸在 sandbox 出現 5 個 browser backing-store／localhost 拒絕，沒有算 Pass；同既有 Chrome 在必要 scoped execution 下，單一本機 IDB 與既有 MV3 IDB 預檢皆過。未修改 W01，也未把未重跑項目補算通過。

MV3 restart 的觀察採 worker globals／performance.timeOrigin 重置及持久資料恢復；Playwright 可能保留同一 Worker handle，不以新事件或 target ID 作判準。[Playwright 官方說明](https://playwright.dev/docs/chrome-extensions#service-worker-idle-suspension-mv3)

## 操作邊界與回復

交付前唯讀核對（2026-10-23 Asia/Taipei）：三庫 main 仍為上述基準，PR15 open／未合併／autoMerge null、head `b4b11ec…`。兩個正式 `/version.json` 均 HTTP 200，build_id `75a9a5bbb34153ef8d891a56401d3c457819b32482b54adf288419b7e51efff8`、data_revision `0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b`。原 Extension 五份 dirty 文件 size／SHA 全數不變；W09 凍結 41 份證據逐檔不變，evidence-index SHA `e6a87f2bf888454db39b9a821c593c2a3c57334f034ce5fdcec47feaec08d579`。

沒有合併 main／PR15、selected、正式配號、網站正式發布、production rollback、新 Source archive、商店送審、Private／Mods 修改、新 token 或審核門檻。新 DB 與 W01 preview namespace 隔離；只撤回本工程時停用隔離 build 或依逆序 revert 本 branch commits，不 reset／clean 使用者工作，不變更 Web／Source 資料或既有 archive。

工程 SHA-256 只驗混版與毀損，不作發布者簽章。正式 HTTPS rollout、W11 DOM/UI、W13 完整代表案例及 W16 商店／正式封裝不在本包宣稱通過。
