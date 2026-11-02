# ATM Monitor · Dhara Sansthan: setup guide

Dashboard: https://avig007.github.io/dharasansthandashboard/monitor/
Master data: https://docs.google.com/spreadsheets/d/1XuvAuErkIzy9IiJ-jgsaw9kFPF4QvcNCWMcWEC7ImI4/edit

| Part | Service | What it does | Free limit |
|---|---|---|---|
| Dashboard page | GitHub Pages | Charts, cost explorer, flags, forms; reads uploaded Excel files in the browser | 1 GB site, 100 GB a month of traffic |
| Master data | Google Sheet (tabs Data, Repairs, Checks, ATMs) | Keeps every month, repair and checklist | 20 million cells: decades of data for 36 plants |
| Link between them | Google Apps Script (`Code.gs`) | Reads the Sheet for the dashboard; writes uploads and forms to it | Free with a Google account |
| AI column matching (optional) | Gemini API, free tier | Matches the columns of an unfamiliar Excel layout | Small daily allowance; manual matching works without it |

Until steps 1–3 are done, the dashboard shows the April–September 2026 data built into the page, and anything uploaded or typed is shown in that browser only.

## 1. Put the script in the Sheet (5 minutes, once)

1. Open the master sheet → **Extensions → Apps Script**.
2. Select everything in `Code.gs` in the editor and delete it. Paste the whole of the new `Code.gs`.
3. On the line `const PASSCODE = 'change-this-passcode';`, replace the text in quotes with a passcode for staff (e.g. `dhara-ro-2026`). Click **Save** (disk icon).
4. Click **Deploy → New deployment** → gear icon → **Web app**.
   - Description: ATM Monitor
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy** → **Authorize access** → choose your Google account → **Advanced → Go to (project name) (unsafe)** → **Allow**. (Google shows this warning for every personal script; it is your own code.)
6. Copy the **Web app URL** (ends in `/exec`).

If you change the code later: **Deploy → Manage deployments → pencil (Edit) → Version: New version → Deploy**. The URL stays the same.

## 2. Connect the dashboard

1. Open the dashboard → **Master data** tab → **Connection**.
2. Paste the `/exec` URL and the passcode → **Save and load**. The badge at the top turns green: "Live · Google Sheet".
3. Click **Copy the bundled Apr–Sep 2026 history into the Sheet** once. This adds the cards, the repair notes and the ATM list to the Sheet (existing rows are updated, not duplicated).

To make every visitor see live data without pasting the URL: in `index.html` set `const DEFAULT_API = '…/exec';` and upload the file to GitHub again. The passcode is still asked before saving.

## 3. Add data each month

Open **Add data** and follow the five steps on screen: get the monthly statement → check it has ATM names, cans, revenue and the month → drop it in → check the preview and the cost check → **Save to Google Sheet**.

## 4. (Optional) AI column matching

1. Get a free key at aistudio.google.com → **Get API key**.
2. Apps Script → **Project Settings** (gear) → **Script properties → Add script property**: `GEMINI_API_KEY` = the key.
3. Deploy a new version (see step 1).

Only column names and three sample rows are sent to the AI, never the full file.

## 5. Sharing

- **The dashboard**: share its link. Anyone can view it; saving needs the passcode. Viewers do not need access to the Sheet, because the script reads it on your behalf.
- **The Google Sheet**: open it → **Share** (top right) → type the person's email → choose **Viewer** (read only), **Commenter** or **Editor** (can change data) → **Send**. To give view-only access to anyone with the link: **General access → Anyone with the link → Viewer**. Keep editing rights to the few people who correct data.
- **Handing over to Dhara Sansthan**: in **Share**, make their staff member an **Editor**, then use the arrow next to their name → **Transfer ownership**. The script moves with the Sheet; they should redeploy it under their account (step 1) and paste the new URL in the dashboard.

## Warning flags used

Money flags (from the monthly figures): cost per can above ₹4; loss two months running; operator pay over half of revenue; sales 25% or more below the ATM's first two months.
Health flags (from the checklist and repair log): TDS above 500 mg/L; pH outside 6.5–8.5; any "No"; 3 or more days shut; 2 or more logged repairs in 3 months.
An ATM with 2 or more money flags, or any red health flag, needs a visit.
