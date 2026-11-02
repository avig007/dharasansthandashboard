/**
 * ATM Monitor · Dhara Sansthan — Google Sheet back end (version 2)
 * Paste into the master sheet: Extensions → Apps Script. Deploy as a web app (see SETUP.md).
 *
 * Tabs it keeps (created automatically if missing):
 *   Data    – one row per ATM per month (or week): cans, revenue, the four running costs, cards
 *   Repairs – repair log (from the monthly statement and from the dashboard form)
 *   Checks  – monthly water and safety checklist
 *   ATMs    – list of ATMs and their status
 *
 * GET  → returns every tab as JSON (the dashboard reads this each time it opens).
 * POST {passcode, tab, rows:[{Header: value, …}]} → adds rows; a row with the same key replaces
 *        the old one (Data: ATM + Period, Repairs: ATM + Date + What was repaired, Checks: ATM + Month,
 *        ATMs: ATM). Re-uploading a corrected file is therefore safe.
 * POST {passcode, action:'map', …} → optional AI column matching (free Gemini API). Only column names
 *        and three sample rows are sent. Needs GEMINI_API_KEY in Project Settings → Script properties.
 */
const PASSCODE = 'change-this-passcode';   // ← change before deploying; staff type this once when saving

const TABS = {
  Data:    { head: ['ATM','Period','Cans','Revenue','Operator pay','Electricity','Repairs and consumables','Other costs','Uploaded at','New cards','Cards registered','Source'],
             key: ['ATM','Period'], text: ['Period'], stamp: 'Uploaded at' },
  Repairs: { head: ['ATM','Date','What was repaired','Cost','Days shut','Fixed by','Notes','Source','Saved at'],
             key: ['ATM','Date','What was repaired'], text: ['Date'], stamp: 'Saved at' },
  Checks:  { head: ['ATM','Month','TDS','pH','Tanks cleaned','Filters changed','Pump OK','Wiring OK','Earthing OK','Card reader OK','No leaks','Days shut','Meter reading','Filled by','Notes','Saved at'],
             key: ['ATM','Month'], text: ['Month'], stamp: 'Saved at' },
  ATMs:    { head: ['ATM','Status'], key: ['ATM'], text: [], stamp: null }
};

function tab_(name) {
  const cfg = TABS[name];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cfg.head.length).setValues([cfg.head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const last = Math.max(1, sh.getLastColumn());
  const head = sh.getRange(1, 1, 1, last).getValues()[0].map(h => String(h).trim());
  while (head.length && head[head.length - 1] === '') head.pop();
  cfg.head.forEach(h => {                       // add any missing column at the end
    if (head.indexOf(h) < 0) { head.push(h); sh.getRange(1, head.length).setValue(h).setFontWeight('bold'); }
  });
  cfg.text.forEach(h => sh.getRange(2, head.indexOf(h) + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@'));  // keep dates as text
  return { sh: sh, head: head, cfg: cfg };
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function text_(v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return v.getDate() === 1 ? Utilities.formatDate(v, tz, 'yyyy-MM') : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return String(v).trim();
}

function doGet() {
  const out = {};
  Object.keys(TABS).forEach(name => {
    const t = tab_(name);
    const v = t.sh.getDataRange().getValues();
    v.shift();
    out[name] = {
      head: t.head,
      rows: v.filter(r => r[0] !== '').map(r => t.head.map((h, i) => {
        const c = r[i];
        if (t.cfg.text.indexOf(h) >= 0) return text_(c);
        return c instanceof Date ? c.toISOString() : (c === undefined ? '' : c);
      }))
    };
  });
  return json_({ ok: true, tabs: out, updated: new Date().toISOString() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  if (body.passcode !== PASSCODE) return json_({ ok: false, error: 'Wrong passcode' });
  if (body.action === 'map') return json_(aiMap_(body));
  const name = body.tab || 'Data';
  if (!TABS[name]) return json_({ ok: false, error: 'Unknown tab ' + name });
  if (!Array.isArray(body.rows) || !body.rows.length) return json_({ ok: false, error: 'No rows' });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const t = tab_(name), sh = t.sh, head = t.head, cfg = t.cfg;
    const v = sh.getDataRange().getValues();
    const keyOf = get => cfg.key.map(h => {
      const x = get(h);
      return (cfg.text.indexOf(h) >= 0 ? text_(x) : String(x == null ? '' : x).trim()).toLowerCase();
    }).join('|');
    const at = {};
    for (let i = 1; i < v.length; i++) at[keyOf(h => v[i][head.indexOf(h)])] = i;
    const now = new Date(), add = [];
    let replaced = 0;
    body.rows.forEach(r => {
      const k = keyOf(h => r[h]);
      const old = at[k] != null ? v[at[k]] : null;
      const row = head.map((h, i) => {
        if (h === cfg.stamp) return now;
        if (r[h] !== undefined && r[h] !== null) return cfg.text.indexOf(h) >= 0 ? String(r[h]) : r[h];
        return old ? old[i] : '';
      });
      if (old) { sh.getRange(at[k] + 1, 1, 1, row.length).setValues([row]); replaced++; }
      else { add.push(row); }
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, head.length).setValues(add);
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
    'other (any other running cost: water charges, housekeeping, misc, tank cleaning), newcards (new connections or cards issued this period), ' +
    'cards (total cards or connections registered at period end), detail (text notes describing expenses or repairs), ' +
    'total (a total-cost column, used only as a check), ignore (anything else: serial numbers, previous-month connections, remarks, surplus, totals of receipts)';
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
