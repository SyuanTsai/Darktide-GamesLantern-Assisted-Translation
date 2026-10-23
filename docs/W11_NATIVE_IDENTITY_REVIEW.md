# W11 真站身分證據續查｜SYP-343｜2026-10-23

現有材料可以重現舊快照完整性、Source 限定範圍的跨版比對及目前真站技能卡匹配；仍無法將目前原站快照可靠對應到 W11 的完整 `1.13.2` identity。因此本輪沒有新增 production 程式或登錄猜測 proof，W11 真站正向注入尚未通過，SYP-343 保持進行中。沒有需要使用者新增的 token、權限、設定或人工審核門檻。

## 已完成的查證

| 證據鏈 | 核對結果 | 可支持的結論與界線 |
| --- | --- | --- |
| 舊 runtime→舊原站完整快照 | 重算 `initialize.native.json.gz` 解壓及 `SHA256(UTF8(JSON.stringify(parsed,null,2)))`，得到 `6ca501cadbbfbe733b894ab9b60189ff50efd2815abc1fc5c785d3c9969d5636`，與舊 catalog／runtime 一致 | 能辨識固定歷史 snapshot；API root沒有數字版本／build／W08 tuple，不能自行建立當前版本映射 |
| 舊 runtime→SteamBuild 25606770／1.13.1 | 固定 catalog 把 patch8、網站 digest及本地1.13.1來源一起記錄；原 `docs/V1_REVIEW.md:24` 已明列原站 patch與解包版無共同發布識別 | 這是歷史本地關聯。原先可以更新，不等於已核實原站的精確數字版本；不能直接改標成1.13.2 |
| Source 1.13.1→1.13.2 | 重新取得固定 Source [provenance](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/67a175213c5222eb389672cc46aff9f93aed0f73/content/legacy/mods/241ad76/psyker/provenance.json)，原 bytes SHA `f1b1cbcb70ae8df1d9e2f33b270d98edd3a1d99951e011a271d4f09df9ea3286`與正式packet一致；表中15檔／28引用位置的兩版blob IDs均相同 | 可沿用這15檔支持的分析，沒有證明原站用了哪個版本。這不是要求整個遊戲逐byte一致 |
| 當前真站卡片→已批准內容 | 正常IAB於 `/abilities` 擷取顱腦崩裂原生名稱／完整可見描述，經未修改的production `matchesSkillObservation`，唯一匹配批准的1筆模型 | 真站slot與該官方文案相符；相同文字不具區分1.13.1／1.13.2的能力，也不驗證所有隱含機制 |
| 歷史身分→W10選版保護 | 用真批准四域及原loader驗 `gameVersion=1.13.1`，結果為 `NO_COMPATIBLE_RELEASE`，未誤選1.13.2；正常空registry仍為unknown | 舊版身分沒有繞過既有選版條件；這是固定輸入的拒絕驗證，並非真站正向MV3注入 |

批准候選依舊為 manifest SHA `bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7`、dataRevision `808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62`、四域7,065,789bytes；未改authoring、Source或收據。

## 當前原站資料來源與擷取限制

從原站DOM引用的兩個公開module查到正常契約：初載 `GET /api/build-editor/initialize`，切網站patch時加 `?patch=<slug>`；Axios設定 `X-Requested-With: XMLHttpRequest`。正常瀏覽器的已觀測資產亦確認該XHR URL。module僅作惰性文字分析，沒有執行下載的原站程式。

匿名HTTP及依正常Accept／XHR headers的GET均收到403；正常IAB直接導航API得到 `[]`。兩者都不能替代編輯器實際使用的完整回應，無法判定這項差異的根因。既有瀏覽器工具可以列出XHR URL，但不能封存JSON類型；未繞過Cloudflare、讀取cookie／儲存區／隱藏Vue state或要求新增權限。**目前完整live response尚未擷取，不宣稱它與舊fixture相同，也不宣稱目前API確定沒有新增版本欄位。**

目前編輯器仍顯示Depths of the Damned／Live。[原站新聞](https://darktide.gameslantern.com/news)已列1.13.4，官方亦分別於[10月20日發布1.13.3](https://forums.fatsharkgames.com/t/hotfix-1-13-3-patch-notes/126774)、[10月22日發布1.13.4](https://www.playdarktide.com/news/special-live-event-arcane-ruin)。這說明同名大更新不足以單獨區分hotfix；新聞日期仍不能直接證明編輯器dataset的版本。

## 還缺哪一段、如何接續

1. 取得正常編輯器本次 `initialize` 的完整公開response原檔，保存確切URL／query、status／final URL及原始bytes／digest。需要的是遊戲資料response，無需帳號、cookie、Authorization、作者build或整份HAR。
2. 在同一snapshot上查出具版本辨識力的欄位或來源關聯，可靠join到現有 `gameVersion/gameReleaseId` 與適用Source snapshot。可接受可重現的本地證據鏈，不新增必須由發布者背書或全遊戲byte比對的條件。單一同名patch、同一句官方描述或候選自己的tuple都不能完成此join。
3. 證據成立後，沿現有本地resolver登錄固定proof，才由同一Luna／Max最小實作並驗真站完整通路；不需合併main、selected、配號、發布或新增archive。若只能證明限定欄位相符，就保留該範圍證據，不冒稱完整release身份。

本輪沒有改動loader的identity語意，沒有把「資料內容相符」偷換成「原站精確版本」。也未新增審核閘門或要求重審既有72項內容；原審閱報告提及publisher-only映射的措辭不作新增要求，以本節的可重現證據條件為準。

## 固定工程與本輪驗證

Extension程式仍為 `f2abf983851c1cc4cf09ae3ee35a8fdf294a6a5c`；Web程式仍為 `87315a748b61d1bac1347ab7529cd4fc8ace4b0b`。原兩庫clean clone各75／0／0與Web CI收據保持，沒有用舊結果聲稱新的真站正向通路成功。本輪僅唯讀資料probe與文件，沒有新增production或測試，因此沒有重跑不受影響的完整回歸；直接probe命令為 `node verify-existing-native-chain.cjs`。

唯一Luna／Max完成Source/runtime唯讀調查；Root獨立重算hash、核對Source公開artifact、正常瀏覽器觀察及既有production matcher／loader的固定輸入probe。本機新證據保存在 `.tmp/w11-native-proof-20261023/`：`source-runtime-review.md`、`scoped-content-evidence-analysis.md`、`existing-native-chain-verification-final.json`、`live-ability-observation.json`、`public-native-observation.json`與HTTP／module擷取收據。原W11的221份固定證據及W09／W10證據保持。

不合併任何main／PR15／PR2、不selected、不保留或分配正式contentVersion、不正式發布／production rollback／新增公開Source archive。沿現有權限，不新增token／審核門檻；不改Private／Mods或武器圖片，不進W12後續範圍，SYP不記工時。
