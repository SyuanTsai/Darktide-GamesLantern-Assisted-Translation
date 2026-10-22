# W11 Extension 顯示工程交付｜SYP-343

兩端的 W11 顯示工程已交付為隔離 draft candidate，W11 整體仍維持進行中。原站 Games Lantern 與 W08 `1.13.2` 完整身分的可靠對應仍缺；正常 build 的 proof registry 為空，保留原站內容。受控正向測試只證明接線可運作，不能代表真站版本已匹配。

## 固定版本與角色

- Extension 基準：W10 draft PR2 `fbb11f526ea31c4d238fe843fb1e4ecdabbabb69`；本次 Phase3a `ae08b62978dcca3fafb631e5e8aa22b1fd09f49b`，完整程式 commit **`f2abf983851c1cc4cf09ae3ee35a8fdf294a6a5c`**。
- [Extension draft PR3](https://github.com/SyuanTsai/Darktide-GamesLantern-Assisted-Translation/pull/3) 以 W10 分支為 base，只呈現 W11 差異。
- [Web draft PR17](https://github.com/SyuanTsai/DarkTide-Web/pull/17)：程式 `87315a748b61d1bac1347ab7529cd4fc8ace4b0b`，含交付文件 head `527b067bb1a454409162ab1dbea527a329aadd18`，以固定 PR15 `b4b11ec055adad42bb6732f833946886446e89cd` 分支為 base。
- 同一位實作者 `/root/w10_implementation`，實際 session 核實 `gpt-6-luna/max`；Root `gpt-6.1-sol/xhigh` 負責計畫、獨立覆核、Git、Jira 與證據。沒有另啟實作者或變更模型。
- 沿用既有權限與工具，不新增 token、人工審核門檻、依賴、框架、資料 owner 或任意 URL 設定。

## 可見行為與需求矩陣

| 對應 | Extension 結果 | 直接證據 |
| --- | --- | --- |
| R05／R06 | 同版官方繁中、獨立有效勘誤、可展開「效果／條件／計算／補充說明／額外說明」與 typed-context 術語；空節不顯示，勘誤在折疊內容之外 | presentation unit；DOM InterT10／30／50 |
| R06 | 祝福獨立閱讀器需先選 blessing、variant，再明確選 LV1–4，沒有默認階級；切 LV 更新完整文字與數字。Source 武器關聯未驗證時明列未知，不推最高階或武器適用性 | presentation UnitT30；DOM InterT90；真 MV3 InterT10 |
| R07 | 精確武器 route／標題／outline mirror／原生圖片結構匹配後，family-only 翻譯保留製造商與 Mk。owned 面板放在完整 hero/header 之後；mark 切換整組 claims、units、曲線原節點、stat tables／semantics、攻擊段、from→to、input／condition、profile／branch | presentation UnitT40／50；DOM InterT70／80 |
| R07／未知保真 | 60／80 是比較點，理論與可取得範圍分開；來源未知維持未知。護甲 classKey 未有已確認顯示名時保持來源定位；不推算傷害或執行來源程式條件 | 真候選逐列 DOM 斷言，與 Web 共用 core parity |
| InterT06 | 只改已匹配 text nodes，保留 SPAN／BR、樣式、node identity、focus、native click/input/change。切回原文、停用、版本變動及 dispose 精確移除 owned 內容；Vue 新文不被舊原文覆蓋 | DOM InterT10／20／40／50／70 |
| identity | SHA-256 只解析本地登錄的固定 evidence→完整 tuple；同名 patch／自填版本／不明 snapshot 不授權。先等晚到 DOM，再固定已驗證、寫入前的 evidence；同文件不熱換資料 | native-identity UnitT10／20；entry UnitT20／30；DOM及MV3 |
| MV3／W10 | 本地 isolated content script→同 runtime／精確 origin／top-frame sender→既有 worker／loader／IDB→base64 原 bytes→caller hash 複驗→DOM。首次6次請求均由 worker 發出；實際 worker 重啟後沿用 cache | message／build unit；真 MV3 InterT10 |
| lifecycle | 既有 observer 忽略 owned 子樹寫入，狀態文字相同不重寫；穩定期不自迴圈。persisted hide/show 事件模擬保留同文件 pin、清除頁面 tier 選擇，並尊重使用者停用意圖，無額外下載 | 真 MV3 穩定期及 disabled BFCache 回歸 |
| 保護邊界 | input／textarea／select／contenteditable（含空值、plaintext-only）／CKEditor／article／guide 不寫入；未知原站祝福列不靠通用 H3/P 或第一個 tier 推定 | DOM InterT40；正常 build MV3 InterT20 |

公開 `Rev It Up` 列包含多武器家族，沒有明確 tier，候選 variant 的 weaponRefs 為空，因此沒有原生 blessing-row writer。獨立閱讀器只閱讀已批准內容，不聲稱該原站列已完成 variant／武器適配。

本地 `view-model.js` 只是 Web shared-view 的 UMD 包裝；移除 wrapper／export 並正規化換行後，核心逐文相同，SHA-256 為 `12135f02ac5ce1e2683137ecccee09285f3abfb5da87ced18a9b7d43a872451b`。Root 用固定真四域核對1技能、4祝福階級、1武器家族／2型號的所有共用欄位，兩端相同。沒有從另一個 checkout 動態載入 production 程式。

## 固定輸入與原始資料

manifest SHA：`bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7`。

dataRevision：`808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62`。

| 域 | bytes | SHA-256 |
| --- | ---: | --- |
| skills | 165051 | `108628d9c9262541bd95741fcc0ef52b08ff874d02ce11eb0684bb52ef6da449` |
| blessings | 113990 | `3e72d21be03b7beb966558665b7a4eb3fb389ea23fab8cf7c1cf722a409b22b5` |
| weapons | 6662191 | `17a554bfc2a4a444b8e4cf89de64e698182deb1936ccebebd10f37f64c4f617a` |
| terms | 124557 | `602cb6aca68e6add34aaa8eb0552efbba66324a97e7c4fbc406f03c0932b78f6` |

合計 `7,065,789` bytes。Source revision `1fdd0881633c623ed8f5ad294613a0747d675e1dad2266b844ce42bf72f73520`；869 approved targets／874 receipts 未變。`1.13.2.1` 僅為隔離提案，actualContentVersion=null、selected=false、allocationReserved=false。測試 version envelope 的 `published` 是沿用格式，沒有正式部署或真正選版／配號。

## 測試與獨立覆核

沿既有 Windows Node `24.19.0`、Playwright `1.64.0`、Chromium `156.0.8078.4`，未安裝或更新工具。真 Chromium 是必要的 DOM／focus／hit-testing／extension boundary 驗證；資料選取與 sender 邊界以單元測試覆蓋。

- Luna W11 定向：13 unit＋8 DOM＋2 真 MV3，全數通過，沒有 skip。最後生命週期 finding 有獨立行為 Red（停用後返回卻變成 ready）與 Green。
- Root working clone：完整 W10＋W11 **75 pass／0 fail／0 skip**（W10 52＋W11 23）；最後 UMD 只同步相同語意及欄位順序，並由 parity probe確認。
- 固定程式 `f2abf98…` 的獨立 Windows clean clone：完整 **75 pass／0 fail／0 skip**，Git 乾淨，沿既有 runtime、不安裝依賴。首次 checkout 遇既有 W02 歷史 fixture 的 Windows 長檔名，只以單次 Git `core.longpaths=true` 參數還原精確缺檔，確認乾淨後才開始測試，沒有修改全域或 repo 設定。
- Web 固定程式的 clean clone 為75 pass／0 fail／0 skip；Web 文件 head `527b067…` 的[既有 CI39870152107](https://github.com/SyuanTsai/DarkTide-Web/actions/runs/39870152107)為563 pass／0 fail／17 skip（15既有＋2本機opt-in），2290靜態檔及既有browser smoke通過，deploy／backup均 skipped。
- Extension repository 沒有 tracked CI workflow；沒有宣稱遠端 Extension CI 已成功。以上75項是實際 Windows 本機驗證。

實際命令（使用上述既有執行檔；四個 env 均在執行命令範圍提供）：

```powershell
$env:SYP_W10_PLAYWRIGHT_ROOT = '<existing-node_modules>'
$env:SYP_W10_CHROMIUM_EXE = '<existing-chrome.exe>'
$env:SYP_W10_APPROVED_PACKAGE_DIR = '<fixed-approved-candidate>'
$env:SYP_W11_APPROVED_PACKAGE_DIR = $env:SYP_W10_APPROVED_PACKAGE_DIR
$tests = @(rg --files tests/w10 tests/w11 -g '*.test.cjs' | Sort-Object)
node --test --test-concurrency=1 $tests
```

沒有給固定候選時，相關 opt-in 測試會明示 skip；本次完整收據已給固定輸入，零跳過。BFCache 使用真 content script 下的 `PageTransitionEvent` persisted hide/show **事件模擬**，未宣稱瀏覽器實際將該頁放入 BFCache。worker 重啟則透過真 CDP worker target 關閉及 fresh global／timeOrigin／IDB 檢查，沒有以重建物件替代。

Root 最終覆核未留工程阻擋 finding。過程中已修正 editability、實際 tooltip 結構與可點擊定位、weapon header 空白／NBSP／hero位置／型號標題、canonical official／有效勘誤／typed terms、late DOM pin、owned observer自迴圈及停用意圖。未為可逆文件／純格式變更加鏡像測試。

## 流程證據與限制

本次 task 的 `.tmp/w11-startup-20261023/` 保留原始 Red／Green、Root logs、固定輸入 hash 與收據：`phase3b-root-final-regression.log`、`phase3b-root-extension-clean-clone.log`、`phase3b-extension-clean-clone-receipt.json`、`phase3b-root-final-parity.json`、`phase3b-disabled-bfcache-red.log`／`green.log`、`phase3b-root-tooltip.log`／`phase3b-root-weapon.log`、各 reader／MV3 receipts 及公開 DOM 觀察。

流程偏差如實保留：最初兩個 consumer builder 測試及 Extension 首次 weapon core 補丁是在實作之後補測，不能稱 test-first Red。後續 Web 有真正缺少行為的 Red；沒有倒造原始執行紀錄。較早一份環境探索 log 曾被後續有效 Red 覆寫，原始 log 已不可用，保留此缺口。早期 navigation／content-script controls timeout 與後來 panel selector finding 分開；不把所有啟動失敗追認為同一根因。先前通用 blessing-row Red／Green 已撤回，不計為原生適配驗收。W10 既有流程偏差不改寫。

真站缺的是可重現、固定來源／方法／digest 對應到完整 `gameVersion/gameReleaseId/snapshotId` 的既有證據。公開 patch label、舊 runtime 同名 patch、官方句子相同，以及候選自己宣告的 tuple 均不足。這不是權限或 token 缺口，不要求新設定或審核門檻。W11保持進行中，取得可靠 native proof 後才可進行真站正向驗證。

## 保護、交付與回復

未合併任何 main／PR15／PR2，未 selected、未保留或分配正式 contentVersion、未正式發布／production rollback／新增公開 Source archive。三庫 main、兩正式站點版本、既有 archive、原 Extension 五份 dirty 檔及 W09 41／W10 22份凍結證據均由 Root另核對保留。武器圖片只保留原站既有 IMG；未實作新圖片，不動 Private／Mods，不進 W12後續或全量遷移／商店範圍。

停止使用隔離 build、按切回原文或停用外掛即可移除 owned 內容；必要時只 revert 本 W11 分支 commits。沒有正式站點切換，不需要 production rollback；不得 reset／clean 原使用者工作副本。
