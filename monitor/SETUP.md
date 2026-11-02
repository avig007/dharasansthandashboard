# ATM Monitor · Dhara Sansthan: setup guide

Dashboard: https://avig007.github.io/dharasansthandashboard/monitor/
Master data: https://docs.google.com/spreadsheets/d/1XuvAuErkIzy9IiJ-jgsaw9kFPF4QvcNCWMcWEC7ImI4/edit

| Part | Service | What it does | Free limit |
|---|---|---|---|
| Dashboard page | GitHub Pages | Charts, cost explorer, flags, forms, sign-in screen; reads uploaded Excel files in the browser | 1 GB site, 100 GB a month of traffic |
| Master data | Google Sheet (tabs Data, Repairs, Checks, ATMs, Access) | Keeps every month, repair, checklist and access request | 20 million cells: decades of data for 36 plants |
| Link and gatekeeper | Google Apps Script (`Code.gs`) | Checks who is signed in, reads the Sheet for the dashboard, saves uploads, emails sign-in codes | Free with a Google account (about 100 emails a day) |
| AI column matching (optional) | xAI Grok, Groq or Google Gemini | Matches the columns of an unfamiliar Excel layout | Depends on the provider |

## 1. Put the script in the Sheet (once)

1. Open the master sheet → **Extensions → Apps Script**. Delete all the code in `Code.gs` and paste the new `Code.gs`.
2. `const PRIVATE = true;` keeps the dashboard private (sign-in with approved emails). Set it to `false` only if anyone with the link may view it; then also set `PASSCODE` for saving.
3. Click **Save**. In the toolbar choose the function **onOpen** and click **Run** once. Allow the permissions (Advanced → Go to … (unsafe) → Allow; it is your own script). This adds the **ATM Monitor** menu to the sheet and lets the script send emails.
4. **Deploy → New deployment** → gear → **Web app** → Execute as **Me** → Who has access **Anyone** → **Deploy**. Copy the **Web app URL** (ends in `/exec`).
   After any later code change: **Deploy → Manage deployments → pencil → Version: New version → Deploy**. The URL stays the same.

"Anyone" only means the web app can be reached. With `PRIVATE = true` it returns no figures until someone signs in with an approved email.

## 2. Switch the dashboard to private

The public page currently has the April–September 2026 figures built in. A private page must carry no data and point at your web app:
- send the `/exec` URL to Claude to rebuild and publish the private version, or
- do it yourself: in `index.html` set `const DEFAULT_API = '…/exec';`, replace the long `const SEED = {…};` line with `const SEED = null;`, and upload the file to GitHub as `monitor/index.html`.

Before switching, connect the public version once (Master data → paste the URL → sign in) and click **Copy the bundled Apr–Sep 2026 history into the Sheet**, so the cards, repair notes and ATM list are in the Sheet.

Note: the GitHub repository is public, and older versions of `index.html` in it still contain the April–September 2026 figures. If that matters, publish the private version from a new repository or delete the old history.

## 3. First sign-in (you, the owner)

Open the dashboard → enter **the Google email that owns the script** → a 6-digit code arrives by email → enter it. The owner is always an Editor and never needs approval.

## 4. How other people get access

1. A new person opens the link → enters their email → fills in name, organisation and reason → **Request access**. They do this only once.
2. You get an email "ATM Monitor: access request from …", and a row appears in the sheet's **Access** tab with Status **Pending**.
3. Approve: set **Status** to **Approved** and **Role** to **Viewer** (look only) or **Editor** (can upload and save). Refuse or remove: **Revoked**.
4. Sheet menu **ATM Monitor → Email newly approved people**. They get an email with the link.
5. They open the link, enter their email, get a 6-digit code and enter it. That browser stays signed in; on another device they only repeat this step.

**ATM Monitor → Sign everyone out** forces a fresh sign-in for everyone (use it if a phone or laptop is lost).

## 5. Add data each month

Open **Add data** and follow the five steps on screen. Only Editors can save to the Sheet.

## 6. AI column matching with a Grok (or Groq / Gemini) key

1. Apps Script → **Project Settings** (gear, left bar) → **Script properties** → **Add script property**.
2. Property `AI_API_KEY`, value: your key → **Save script properties**. The script recognises the provider from the key: `xai-…` = xAI Grok, `gsk_…` = Groq, anything else = Google Gemini.
3. Optional: property `AI_MODEL` = a model name from your provider's console. Without it, the script asks the provider which models the key can use and picks a fast text model.
4. Test: in the editor choose the function **testAI** → **Run** → **Execution log**. You should see `"ok":true` with a mapping such as `"atm","cans","revenue"`.
5. Deploy a new version (step 1.4). In the dashboard, **Ask AI to map the columns** appears under *Column matching* after a file is uploaded.

Only column names and three sample rows are sent to the AI, never the whole file. xAI charges per use after any free credits; Groq has a free tier.

## 7. Sharing the Google Sheet itself

Dashboard users do **not** need access to the Sheet; the script reads it for them. Share the Sheet only with people who should see or correct the raw data: **Share** (top right) → enter email → **Viewer**, **Commenter** or **Editor** → **Send**. Keep **General access** on **Restricted**.

To hand everything over to Dhara Sansthan: make their staff member an Editor, then click the arrow next to their name in **Share** → **Transfer ownership**. They then redeploy the script from their account (step 1) and the dashboard is rebuilt with the new URL.

## Warning flags used

Money flags (from the monthly figures): cost per can above ₹4; loss two months running; operator pay over half of revenue; sales 25% or more below the ATM's first two months.
Health flags (from the checklist and repair log): TDS above 500 mg/L; pH outside 6.5–8.5; any "No"; 3 or more days shut; 2 or more logged repairs in 3 months.
An ATM with 2 or more money flags, or any red health flag, needs a visit.
