# ATM Monitor · Dhara Sansthan: setup guide

The dashboard runs on three free services:

| Part | Service | What it does | Free limit |
|---|---|---|---|
| Dashboard page | GitHub Pages | Shows the charts, flags and tables; reads uploaded Excel files in the browser | 1 GB site, 100 GB a month of traffic |
| Master data | Google Sheet ("Data" tab) | Stores one row per ATM per month or week | 20 million cells, i.e. thousands of years of monthly data for 36 plants |
| Link between them | Google Apps Script (`Code.gs`) | Reads the Sheet for the dashboard; writes uploaded rows to it | Free with a Google account |
| AI column matching (optional) | Gemini API, free tier | Matches the columns of an unfamiliar Excel layout | Small daily allowance; manual matching works without it |

Until steps 1–3 are done, the dashboard shows the April–September 2026 data built into the page, and uploads appear in the dashboard only (they are not saved).

## 1. Connect the Google Sheet

1. Open the master sheet: **ATM Monitor – Master Data (Dhara Sansthan)**.
2. Go to **Extensions → Apps Script**. Delete any code in the editor and paste the whole of `Code.gs`.
3. On the line `const PASSCODE = 'change-this-passcode';`, replace the text in quotes with a passcode for staff. Save.
4. Click **Deploy → New deployment**. Choose type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, allow the permissions Google asks for, and copy the **Web app URL** (it ends in `/exec`).

## 2. Point the dashboard at the Sheet

Either:
- **For one computer:** open the dashboard, click **Settings**, paste the `/exec` URL and the passcode, and save. Or
- **For everyone:** in `index.html`, find `const DEFAULT_API = '';`, paste the URL between the quotes and upload the file again. Every visitor then sees the live Sheet. Staff still type the passcode once, in Settings, before they can save uploads.

## 3. Upload data each month

1. Click **Upload data** and choose the file. The dashboard accepts:
   - Dhara Sansthan's monthly **Statement of Receipts & Payments**, as it is (one sheet per month is fine);
   - any sheet with **one row per ATM** (column names are matched automatically; you can correct them by hand, or ask the AI);
   - the optional simple template (button in the upload window).
2. Check the preview: totals, the cost check against the sheet's own total column, and any new ATM names.
3. Click **Save to Google Sheet**. Re-uploading the same ATM and period replaces the old row, so corrections are safe.

Weekly files: give the week's start date as the period (for example 2026-10-05). The dashboard adds weeks into months.

## 4. (Optional) Switch on AI column matching

1. Get a free API key at **Google AI Studio** (aistudio.google.com → Get API key).
2. In Apps Script, open **Project Settings → Script properties → Add script property**.
   - Property: `GEMINI_API_KEY`, value: the key.
   - (Optional) `GEMINI_MODEL`, if Google renames the default model.
3. Deploy again: **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The URL stays the same.

Only the column names and three sample rows of the uploaded sheet are sent to the AI, never the full file. If the free daily allowance runs out, match the columns by hand in the upload window; the dashboard remembers each layout once matched.

## Warning flags used

An ATM is flagged in a month when any of these is true:
- cost per can is above ₹4;
- it ran at a loss two months in a row;
- operator pay is more than half its revenue;
- cans sold are at least 25% below its own three-month average.
