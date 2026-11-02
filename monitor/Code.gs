/**
 * ATM Monitor · Dhara Sansthan — Google Sheet back end (version 3: private access + AI matching)
 * Paste into the master sheet: Extensions → Apps Script. Deploy as a web app (see SETUP.md).
 *
 * Tabs it keeps (created automatically if missing):
 *   Data    – one row per ATM per month (or week): cans, revenue, the four running costs, cards
 *   Repairs – repair log (from the monthly statement and from the dashboard form)
 *   Checks  – monthly water and safety checklist
 *   ATMs    – list of ATMs and their status
 *   Access  – who asked for access and who is approved (only when PRIVATE = true)
 *
 * PRIVATE = true: nobody sees any figures until you approve them.
 *   A new visitor types their email → you get an email → you set Status to "Approved" in the Access tab
 *   (Role "Viewer" = look only, "Editor" = can upload and save) → they type their email again, get a
 *   6-digit code by email, enter it once, and that browser stays signed in. Set Status to "Revoked"
 *   to remove someone.
 *
 * AI column matching (optional): put ONE key in Project Settings → Script properties:
 *   AI_API_KEY = a Groq key (gsk_…), an xAI Grok key (xai-…) or a Google Gemini key.
 *   Optional AI_MODEL to choose the model. Only column names and three sample rows are sent.
 */
const PRIVATE = true;                                  // false = anyone with the link can view; saving needs PASSCODE
const PASSCODE = 'change-this-passcode';               // used only when PRIVATE = false
const DASHBOARD_URL = 'https://avig007.github.io/dharasansthandashboard/monitor/';

const TABS = {
  Data:    { head: ['ATM','Period','Cans','Revenue','Operator pay','Electricity','Repairs and consumables','Other costs','Uploaded at','New cards','Cards registered','Source'],
             key: ['ATM','Period'], text: ['Period'], stamp: 'Uploaded at' },
  Repairs: { head: ['ATM','Date','What was repaired','Cost','Days shut','Fixed by','Notes','Source','Saved at'],
             key: ['ATM','Date','What was repaired'], text: ['Date'], stamp: 'Saved at' },
  Checks:  { head: ['ATM','Month','TDS','pH','Tanks cleaned','Filters changed','Pump OK','Wiring OK','Earthing OK','Card reader OK','No leaks','Days shut','Meter reading','Filled by','Notes','Saved at'],
             key: ['ATM','Month'], text: ['Month'], stamp: 'Saved at' },
  ATMs:    { head: ['ATM','Status'], key: ['ATM'], text: [], stamp: null }
};
const ACCESS_HEAD = ['Email','Name','Organisation','Reason','Requested at','Status','Role','Approval emailed','Last seen'];

/* ---------- sheet helpers ---------- */
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
  cfg.head.forEach(h => {
    if (head.indexOf(h) < 0) { head.push(h); sh.getRange(1, head.length).setValue(h).setFontWeight('bold'); }
  });
  cfg.text.forEach(h => sh.getRange(2, head.indexOf(h) + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@'));
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

/* ---------- access control ---------- */
function owner_() { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); }
function access_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Access');
  if (!sh) {
    sh = ss.insertSheet('Access');
    sh.getRange(1, 1, 1, ACCESS_HEAD.length).setValues([ACCESS_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 6, 999, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Pending','Approved','Revoked'], true).build());
    sh.getRange(2, 7, 999, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Viewer','Editor'], true).build());
  }
  return sh;
}
function findUser_(email) {
  const sh = access_(), v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][0]).trim().toLowerCase() === email) {
    return { row: i + 1, email: email, name: v[i][1], status: String(v[i][5] || 'Pending'), role: String(v[i][6] || 'Viewer') };
  }
  return null;
}
function user_(email) {      // the owner is always approved as Editor
  const u = findUser_(email);
  if (email === owner_()) return { row: u ? u.row : null, email: email, name: u ? u.name : 'Owner', status: 'Approved', role: 'Editor' };
  return u;
}
function secret_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('TOKEN_SECRET', s); }
  return s;
}
function token_(email) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(email, secret_())).replace(/=+$/, '');
}
const validEmail_ = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function signedIn_(email, token) {   // → user object if the token is valid and the person is still approved
  email = String(email || '').trim().toLowerCase();
  if (!email || !token || token !== token_(email)) return null;
  const u = user_(email);
  if (!u || u.status !== 'Approved') return null;
  if (u.row) access_().getRange(u.row, 9).setValue(new Date());
  return u;
}

/* ---------- web app ---------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  let role = 'Viewer';
  if (PRIVATE) {
    const u = signedIn_(p.email, p.token);
    if (!u) return json_({ ok: false, auth: 'required', error: 'Sign-in needed' });
    role = u.role;
  }
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
  return json_({ ok: true, tabs: out, role: role, private: PRIVATE, updated: new Date().toISOString() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  const email = String(body.email || '').trim().toLowerCase();

  // sign-in steps (no token needed)
  if (body.action === 'start')   return json_(start_(email));
  if (body.action === 'request') return json_(request_(email, body));
  if (body.action === 'verify')  return json_(verify_(email, String(body.code || '').trim()));

  // everything else needs a signed-in Editor (private) or the passcode (public)
  if (PRIVATE) {
    const u = signedIn_(email, body.token);
    if (!u) return json_({ ok: false, auth: 'required', error: 'Sign-in needed' });
    if (u.role !== 'Editor') return json_({ ok: false, error: 'Your access is view-only. Ask the owner for Editor access to save data.' });
  } else if (body.passcode !== PASSCODE) {
    return json_({ ok: false, error: 'Wrong passcode' });
  }
  if (body.action === 'map') return json_(aiMap_(body));
  return json_(save_(body));
}

function start_(email) {
  if (!PRIVATE) return { ok: false, error: 'This dashboard is not private.' };
  if (!validEmail_(email)) return { ok: false, error: 'Please enter a valid email address.' };
  const u = user_(email);
  if (!u) return { ok: true, step: 'details' };
  if (u.status === 'Revoked') return { ok: false, error: 'Access for this email has been removed. Contact the dashboard owner.' };
  if (u.status !== 'Approved') return { ok: true, step: 'pending' };
  const cache = CacheService.getScriptCache();
  if (cache.get('sent:' + email)) return { ok: true, step: 'code', note: 'A code was sent less than a minute ago. Check your inbox and spam folder.' };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('code:' + email, code, 900);
  cache.put('tries:' + email, '0', 900);
  cache.put('sent:' + email, '1', 60);
  MailApp.sendEmail({ to: email, subject: 'ATM Monitor sign-in code: ' + code,
    body: 'Your sign-in code for the Dhara Sansthan ATM Monitor is ' + code + '.\nIt works for 15 minutes.\n\n' + DASHBOARD_URL });
  return { ok: true, step: 'code' };
}
function request_(email, b) {
  if (!PRIVATE) return { ok: false, error: 'This dashboard is not private.' };
  if (!validEmail_(email)) return { ok: false, error: 'Please enter a valid email address.' };
  const name = String(b.name || '').trim().slice(0, 80), org = String(b.org || '').trim().slice(0, 120), why = String(b.reason || '').trim().slice(0, 500);
  if (!name) return { ok: false, error: 'Please enter your name.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (user_(email)) return { ok: true, step: 'pending' };
    access_().appendRow([email, name, org, why, new Date(), 'Pending', 'Viewer', '', '']);
  } finally { lock.releaseLock(); }
  const cache = CacheService.getScriptCache();
  if (!cache.get('ownermail:' + email)) {
    cache.put('ownermail:' + email, '1', 21600);
    MailApp.sendEmail({ to: owner_(), subject: 'ATM Monitor: access request from ' + name,
      body: name + ' (' + email + ')' + (org ? ', ' + org : '') + ' asked for access.\nReason: ' + (why || '—') +
        '\n\nTo approve: open the master sheet → Access tab → set Status to "Approved" (Role: Viewer or Editor).\n' +
        SpreadsheetApp.getActiveSpreadsheet().getUrl() + '\nThen use the menu ATM Monitor → Email newly approved people.' });
  }
  return { ok: true, step: 'pending' };
}
function verify_(email, code) {
  if (!PRIVATE) return { ok: false, error: 'This dashboard is not private.' };
  const cache = CacheService.getScriptCache();
  const want = cache.get('code:' + email);
  const tries = Number(cache.get('tries:' + email) || 0);
  if (!want || tries >= 5) return { ok: false, error: 'The code has expired. Ask for a new one.' };
  if (code !== want) { cache.put('tries:' + email, String(tries + 1), 900); return { ok: false, error: 'That code is not right. Check the latest email.' }; }
  cache.remove('code:' + email);
  const u = user_(email);
  if (!u || u.status !== 'Approved') return { ok: false, error: 'Access is not approved for this email.' };
  return { ok: true, token: token_(email), role: u.role, name: u.name || '' };
}

function save_(body) {
  const name = body.tab || 'Data';
  if (!TABS[name]) return { ok: false, error: 'Unknown tab ' + name };
  if (!Array.isArray(body.rows) || !body.rows.length) return { ok: false, error: 'No rows' };
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
    return { ok: true, added: add.length, replaced: replaced };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- sheet menu for the owner ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('ATM Monitor')
    .addItem('Email newly approved people', 'emailApproved')
    .addItem('Sign everyone out (new sign-in needed)', 'signOutAll')
    .addToUi();
}
function emailApproved() {
  const sh = access_(), v = sh.getDataRange().getValues();
  let n = 0;
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][5]) === 'Approved' && !v[i][7] && validEmail_(String(v[i][0]).trim())) {
      MailApp.sendEmail({ to: String(v[i][0]).trim(), subject: 'Your access to the ATM Monitor is approved',
        body: 'Hello ' + (v[i][1] || '') + ',\n\nYou can now open the Dhara Sansthan ATM Monitor (' + (v[i][6] || 'Viewer') + ' access):\n' + DASHBOARD_URL +
          '\n\nEnter this email address; you will receive a 6-digit sign-in code.' });
      sh.getRange(i + 1, 8).setValue(new Date());
      n++;
    }
  }
  SpreadsheetApp.getUi().alert(n ? 'Emailed ' + n + ' person(s).' : 'Nobody new to email. Set Status to "Approved" first.');
}
function signOutAll() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN_SECRET');
  SpreadsheetApp.getUi().alert('Everyone is signed out. Approved people sign in again with a new code.');
}

/* ---------- optional: AI column matching (Groq, xAI Grok or Gemini) ---------- */
function aiMap_(body) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('AI_API_KEY') || props.getProperty('GROK_API_KEY') || props.getProperty('GROQ_API_KEY') || props.getProperty('XAI_API_KEY') || props.getProperty('GEMINI_API_KEY');
  if (!key) return { ok: false, error: 'AI matching is not switched on (add AI_API_KEY in Script properties)' };
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

  let url, payload, read;
  if (/^gsk_/.test(key) || /^xai-/.test(key)) {             // Groq or xAI Grok: OpenAI-style chat API
    const groq = /^gsk_/.test(key);
    url = groq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions';
    const model = props.getProperty('AI_MODEL') || pickModel_(key, groq);
    payload = { model: model, temperature: 0, max_tokens: 1200, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'Reply with a single JSON object only.' }, { role: 'user', content: prompt }] };
    read = j => j.choices[0].message.content;
    if (groq && /gpt-oss/.test(model)) payload.reasoning_effort = 'low';      // keep "thinking" short
    if (groq && /qwen3/.test(model)) payload.reasoning_effort = 'none';
  } else {                                                   // Google Gemini
    const model = props.getProperty('AI_MODEL') || 'gemini-flash-latest';
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
    payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } };
    read = j => j.candidates[0].content.parts[0].text;
  }
  const opts = { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload) };
  if (/^gsk_|^xai-/.test(key)) opts.headers = { Authorization: 'Bearer ' + key };
  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  if (code !== 200) {
    let why = '';
    try { why = JSON.parse(res.getContentText()).error; why = typeof why === 'string' ? why : (why && why.message) || ''; } catch (err) {}
    return { ok: false, error: 'AI service returned ' + code + (code === 429 ? ' (limit reached; try later or map by hand)' : '') + (why ? ': ' + String(why).slice(0, 160) : '') };
  }
  try {
    const raw = String(read(JSON.parse(res.getContentText()))).replace(/<think>[\s\S]*?<\/think>/g, '');
    const out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    if (!Array.isArray(out.mapping)) throw new Error('no mapping');
    return { ok: true, mapping: out.mapping, period: out.period && /^\d{4}-\d{2}$/.test(out.period) ? out.period : null };
  } catch (err) {
    return { ok: false, error: 'Could not read the AI reply' };
  }
}

/* No AI_MODEL set: ask the provider which models this key can use and pick a small, fast text model. */
function pickModel_(key, groq) {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('AI_MODEL_PICKED');
  if (saved) return saved;
  const fallback = groq ? 'llama-3.3-70b-versatile' : 'grok-3-mini';
  try {
    const res = UrlFetchApp.fetch(groq ? 'https://api.groq.com/openai/v1/models' : 'https://api.x.ai/v1/models',
      { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
    const ids = JSON.parse(res.getContentText()).data.map(m => m.id).filter(id => !/image|vision|imagine|whisper|tts|guard|embed|audio|compound|prompt/i.test(id));
    // fast, non-reasoning text models first: they answer in a few hundred tokens and stay within free per-minute limits
    const prefs = groq ? [/llama-3\.3-70b-versatile/, /llama-3\.\d+-8b-instant/, /llama.*(70b|8b)/, /gpt-oss-20b/, /gpt-oss/, /llama/, /kimi|mistral|gemma/] : [/grok.*fast.*non-reasoning/, /grok.*fast/, /grok.*mini/, /grok/];
    for (const re of prefs) { const hit = ids.find(id => re.test(id)); if (hit) { props.setProperty('AI_MODEL_PICKED', hit); return hit; } }
  } catch (err) {}
  return fallback;
}

/* Run this once from the editor (select testAI → Run) to check the AI key works. */
function testAI() {
  const r = aiMap_({ sheet: 'April 2026', columns: ['Sr.No', 'Name of the Plant', 'No. of Cans (Water sold)', 'Revenu Total', 'Operator Salary', 'Electricity charges'],
    samples: [[1, 'Baad Shyopur', 11725, 48580, 14000, 9215]] });
  Logger.log(JSON.stringify(r));
}
