# Darktide GamesLantern Assisted Translation

## Overview

**What it is:** An independent Chrome extension that displays Traditional Chinese translations on supported Darktide pages on GamesLantern using verified DarkTide-Source-Data translations.

**Problem it solves:** Read game entries in Traditional Chinese while browsing GamesLantern, with the option to switch back to the original text on the page.

**Key features**

| Feature | How it works |
| --- | --- |
| In-page translations | Checks game entries on supported skill, weapon, and build editor pages against verified data. Text changes only when there is one exact match. |
| Blessing reference | Browse blessings, variants, and tiers from verified data in a separate reader on the weapon blessings page. |

**Requirements:** Chrome for local installation. Building the ZIP requires Windows, Node.js with npm, and PowerShell (`pwsh`).

**Quick start:**

1. Run `npm run package:w16:release -- --version 0.2.33 --output-dir "../gameslantern-release-0.2.33"` from the repository root. The output directory is created next to the repository and must not exist yet.
2. Extract the ZIP, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. Select the extracted folder containing `manifest.json`. See [local installation and verification](docs/w16/release-runbook.md#local-installation-and-verification).
3. Open a supported GamesLantern page. Use **啟用繁體** to enable Traditional Chinese or **切回原文** to restore the original text.

**Privacy:** The extension matches page content locally in the browser and does not upload it. It fetches public data from a fixed HTTPS data site. See the [privacy policy](PRIVACY.md).

**Attribution:** Original page content comes from GamesLantern. This community extension has no official affiliation with GamesLantern, Fatshark, or Games Workshop.

## 概覽

**這是什麼：** 這是一款獨立的 Chrome 擴充功能，使用經驗證的 DarkTide-Source-Data 翻譯資料，在 GamesLantern 支援的 Darktide 頁面上顯示繁體中文翻譯。

**解決的問題：** 瀏覽 GamesLantern 時，可以直接用繁體中文閱讀遊戲項目，也可以在頁面上切回原文。

**主要功能**

| 功能 | 運作方式 |
| --- | --- |
| 頁面翻譯 | 在支援的技能、武器與配裝編輯器頁面，比對遊戲項目與已驗證的資料。只有找到唯一且完全相符的項目才會替換文字。 |
| 祝福參考 | 在武器祝福頁面的獨立閱讀器中，查閱已驗證資料中的祝福、變體與階級。 |

**環境需求：** 本機安裝使用 Chrome。建立 ZIP 需要 Windows、Node.js（含 npm）與 PowerShell（`pwsh`）。

**快速開始：**

1. 在儲存庫根目錄執行 `npm run package:w16:release -- --version 0.2.33 --output-dir "../gameslantern-release-0.2.33"`。輸出目錄會建立在儲存庫旁邊，且必須尚未存在。
2. 解壓縮 ZIP，開啟 `chrome://extensions` 並啟用開發人員模式，選擇**載入未封裝項目**，再選取解壓縮後包含 `manifest.json` 的資料夾。詳見[本機安裝與驗證](docs/w16/release-runbook.md#local-installation-and-verification)。
3. 開啟支援的 GamesLantern 頁面。選擇**啟用繁體**來顯示繁體中文，或選擇**切回原文**來還原原始文字。

**隱私：** 擴充功能在瀏覽器本機比對頁面內容，不會上傳這些內容。它從固定的 HTTPS 資料站下載公開資料。詳見[隱私政策](PRIVACY.md)。

**內容來源：** 原始頁面內容來自 GamesLantern。這款社群擴充功能與 GamesLantern、Fatshark 或 Games Workshop 均無官方關係。

---

Source-Data 載入流程、傳輸驗證與容量上限請見 [Source-Data 載入器](docs/SOURCE_DATA_LOADER.md)。
