/**
 * ATM Monitor · Dhara Sansthan — Google Sheet back end
 * Paste into the master sheet: Extensions → Apps Script. Deploy as a web app (see SETUP.md).
 * GET  → returns every row of the "Data" tab as JSON (the dashboard reads this).
 * POST → adds rows sent by the dashboard's "Upload data" button. A row with the same ATM and
 *        Period as an existing row replaces it, so re-uploading a corrected file is safe.
 * POST {action:'map'} → optional AI column matching for unfamiliar Excel layouts, using the free
 *        Gemini API. Only the column names and three sample rows are sent. Needs a GEMINI_API_KEY
 *        in Project Settings → Script properties (see SETUP.md). Without it, everything else still works.
 */
const SHEET_NAME = 'Data';
const PASSCODE = 'change-this-passcode';   // ← change before deploying; staff type this once when uploading
const HEAD = ['ATM','Period','Cans','Revenue','Operator pay','Electricity','Repairs and consumables','Other costs','Uploaded at'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold'); sh.setFrozenRows(1); }
  sh.getRange('B:B').setNumberFormat('@');   // keep periods as text (2026-10, 2026-10-05)
  return sh;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function period_(v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return v.getDate() === 1 ? Utilities.formatDate(v, tz, 'yyyy-MM') : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return String(v).trim();
}
function key_(atm, period) { return String(atm).trim().toLowerCase() + '|' + period_(period); }

function doGet() {
  const v = sheet_().getDataRange().getValues();
  const head = v.shift() || HEAD;
  const rows = v.filter(r => r[0] !== '').map(r => r.map((c, i) => i === 1 ? period_(c) : (c instanceof Date ? c.toISOString() : c)));
  return json_({ ok: true, head: head, rows: rows, updated: new Date().toISOString() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  if (body.passcode !== PASSCODE) return json_({ ok: false, error: 'Wrong passcode' });
  if (body.action === 'map') return json_(aiMap_(body));
  if (!Array.isArray(body.rows) || !body.rows.length) return json_({ ok: false, error: 'No rows' });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_();
    const v = sh.getDataRange().getValues();
    const at = {};
    for (let i = 1; i < v.length; i++) at[key_(v[i][0], v[i][1])] = i + 1;
    const now = new Date(), add = [];
    let replaced = 0;
    body.rows.forEach(r => {
      const n = x => Number(x) || 0;
      const row = [String(r.atm).trim(), String(r.period).trim(), n(r.cans), n(r.revenue), n(r.op), n(r.elec), n(r.rep), n(r.other), now];
      const k = key_(row[0], row[1]);
      if (at[k]) { sh.getRange(at[k], 1, 1, row.length).setValues([row]); replaced++; }
      else { add.push(row); }
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, HEAD.length).setValues(add);
    return json_({ ok: true, added: add.length, replaced: replaced });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- optional: AI column matching (Gemini API, free tier) ---------- */
function aiMap_(body) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) return { ok: false, error: 'AI matching is not switched on (no GEMINI_API_KEY in Script properties)' };
  const model = props.getProperty('GEMINI_MODEL') || 'gemini-flash-latest';
  const fields = 'atm (ATM / plant / village name), period (month or week date, if there is such a column), cans (number of 20-litre cans or water sold), ' +
    'revenue (total money received from water sales; use only the total if there is one), revpart (one part of revenue that must be added up, only if no total exists), ' +
    'op (operator salary or pay), elec (electricity bill), rep (repairs, maintenance, filters, chemicals, consumables), ' +
    'other (any other running cost: water charges, housekeeping, misc, tank cleaning), total (a total-cost column, used only as a check), ignore (anything else: serial numbers, connections, cards, remarks, surplus, totals of receipts)';
  const prompt = 'You map spreadsheet columns for a dashboard of community RO water ATMs in Rajasthan, India. ' +
    'Each data row is one ATM for one period. Assign every column exactly one of these field codes: ' + fields + '. ' +
    'Exactly one column should be atm. Also, if the sheet name or values show the month, give it as YYYY-MM, else null. ' +
    'Reply with JSON only: {"mapping":["code for column 0","code for column 1",...],"period":"YYYY-MM or null"}.\n\n' +
    'Sheet name: ' + body.sheet + '\nColumns (in order): ' + JSON.stringify(body.columns) + '\nSample rows: ' + JSON.stringify(body.samples);
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } })
  });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'AI service returned ' + res.getResponseCode() + (res.getResponseCode() === 429 ? ' (free daily limit reached; try tomorrow or map by hand)' : '') };
  try {
    const text = JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
    const out = JSON.parse(text);
    if (!Array.isArray(out.mapping)) throw new Error('no mapping');
    return { ok: true, mapping: out.mapping, period: out.period && /^\d{4}-\d{2}$/.test(out.period) ? out.period : null };
  } catch (err) {
    return { ok: false, error: 'Could not read the AI reply' };
  }
}
