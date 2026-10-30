// Pure helpers (no Google services) so they can be tested locally with `npm test`.

function normCompany_(s) {
  return String(s || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(inc|llc|ltd|plc|corp|corporation|co|company|the|group|holdings)\b\.?/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

function normText_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitTitles_(s) {
  return String(s || '').split(/[;\n]/).map(t => t.trim()).filter(Boolean);
}

// Exact title match against Position or any Other Titles (ignoring case and punctuation).
function titleMatches_(row, title) {
  const want = normText_(title);
  return [row['Position']].concat(splitTitles_(row['Other Titles']))
    .some(t => normText_(t) === want);
}

function locationCompatible_(row, location) {
  const a = normText_(row['Location']);
  const b = normText_(location);
  return !a || !b || a === b;
}

function dayOnly_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function cycleFor_(date) {
  const y = date.getFullYear();
  return 'Summer ' + (date.getMonth() + 1 >= CONFIG.CYCLE_START_MONTH ? y + 1 : y);
}

function previousCycle_(cycle) {
  const m = /(\d{4})/.exec(cycle || '');
  return m ? 'Summer ' + (Number(m[1]) - 1) : '';
}

// For dates typed without a year: which year a month falls in for a given cycle.
function yearForMonthInCycle_(month, cycle) {
  const y = Number(/(\d{4})/.exec(cycle)[1]);
  return month >= CONFIG.CYCLE_START_MONTH ? y - 1 : y;
}

// Old-sheet dates arrive as Date objects or strings like "2/25/26", "3/15/2026", "11/4".
function parseOldDate_(v, tabCycle) {
  if (v instanceof Date && !isNaN(v)) return dayOnly_(v);
  const m = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*$/.exec(String(v || ''));
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = m[3] ? Number(m[3]) : yearForMonthInCycle_(month, tabCycle);
  if (year < 100) year += 2000;
  return new Date(year, month - 1, day);
}

function mapOldStatus_(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!v || v === 'submitted') return { status: 'Submitted' };
  if (v === 'rejected') return { status: 'Rejected' };
  if (v === 'in progress') return { status: 'In Progress' };
  if (v === 'ghosted') return { status: 'Ghosted' };
  if (v === 'offer') return { status: 'Offer' };
  if (v === 'interview') return { status: 'In Progress', interview: 'Invited' };
  return { status: 'Submitted', note: 'old status: ' + String(s).trim() };
}

function statusRank_(s) {
  const k = String(s || '').trim();
  return k in STATUS_RANK ? STATUS_RANK[k] : Infinity; // unknown (your own value): never overwritten
}

function rowLabel_(row) {
  const loc = row['Location'] ? ' (' + row['Location'] + ')' : '';
  const date = row['Date Applied'] instanceof Date
    ? ' · ' + (row['Date Applied'].getMonth() + 1) + '/' + row['Date Applied'].getDate() + '/' + row['Date Applied'].getFullYear()
    : '';
  return row['Company'] + ' — ' + (row['Position'] || '(no title)') + loc + date + ' [#' + row['ID'] + ']';
}

function idFromLabel_(s) {
  const m = /#([A-Za-z0-9]+)\]?\s*$/.exec(String(s || ''));
  return m ? m[1] : '';
}

/**
 * Decides what an email event means for the tracker.
 * ev: { type: 'CONFIRMATION'|'REJECTION'|'OA_INVITE', company, title, location, date }
 * pick(ev, candidates) asks Gemini which candidate row (if any) is the same application:
 *   returns { row: <row or null>, confident: bool }
 * Returns { action: 'update', row } | { action: 'create' } | { action: 'review', reason, candidates }
 */
function matchEvent_(rows, ev, pick) {
  const cycle = cycleFor_(ev.date);
  const company = normCompany_(ev.company);
  const sameCompany = rows.filter(r => normCompany_(r['Company']) === company);
  const exactIn = pool => pool.find(r => titleMatches_(r, ev.title) && locationCompatible_(r, ev.location));

  if (ev.type === 'CONFIRMATION') {
    const pool = sameCompany.filter(r => r['Cycle'] === cycle);
    const exact = exactIn(pool);
    if (exact) return { action: 'update', row: exact };
    // Rows you typed by hand that no email has claimed yet may be this application under shorthand.
    const unlinked = pool.filter(r => !r['Gmail Link']);
    if (!unlinked.length) return { action: 'create' };
    const p = pick(ev, unlinked);
    if (!p.confident) return { action: 'review', reason: 'Might be one of your existing rows', candidates: unlinked };
    return p.row ? { action: 'update', row: p.row } : { action: 'create' };
  }

  // Rejections and OA invites can arrive after the cycle rolls over, so look one cycle back too.
  const pool = sameCompany.filter(r => r['Cycle'] === cycle || r['Cycle'] === previousCycle_(cycle));
  const exact = exactIn(pool);
  if (exact) return { action: 'update', row: exact };
  const open = pool.filter(r => statusRank_(r['Status']) < STATUS_RANK['Rejected']);
  if (!open.length) return { action: 'create' };
  if (!ev.title) {
    if (open.length === 1) return { action: 'update', row: open[0] };
    return { action: 'review', reason: 'Email doesn\'t say which role; you have several open rows at this company', candidates: open };
  }
  const p = pick(ev, open);
  if (!p.confident) return { action: 'review', reason: 'Role title doesn\'t exactly match your rows', candidates: open };
  return p.row ? { action: 'update', row: p.row } : { action: 'create' };
}

/**
 * Field changes to make to an existing row for an event. Never overwrites your edits, except that
 * the official title replaces shorthand on rows no email has claimed yet.
 */
function changesForEvent_(row, ev) {
  const c = {};
  const linked = !!row['Gmail Link'];
  if (ev.title && !titleMatches_(row, ev.title)) {
    if (!linked || !row['Position']) c['Position'] = ev.title;
    else c['Other Titles'] = splitTitles_(row['Other Titles']).concat(ev.title).join('; ');
  }
  if (ev.location && !row['Location']) c['Location'] = ev.location;
  if (ev.type === 'CONFIRMATION' && !row['Date Applied']) {
    c['Date Applied'] = dayOnly_(ev.date);
    c['Cycle'] = cycleFor_(ev.date);
  }
  if (!linked && ev.link) c['Gmail Link'] = ev.link;
  const target = EVENT_STATUS[ev.type];
  if (statusRank_(target) > statusRank_(row['Status'])) c['Status'] = target;
  if (ev.type === 'OA_INVITE' && !row['OA']) c['OA'] = 'Invited';
  if (Object.keys(c).length) {
    const last = row['Last Updated'] instanceof Date ? row['Last Updated'] : null;
    if (!last || ev.date > last) c['Last Updated'] = dayOnly_(ev.date);
  }
  return c;
}

function newRowForEvent_(ev, id) {
  return {
    'Cycle': cycleFor_(ev.date),
    'Company': ev.company,
    'Position': ev.title || '',
    'Location': ev.location || '',
    'Date Applied': ev.type === 'CONFIRMATION' ? dayOnly_(ev.date) : '',
    'Status': EVENT_STATUS[ev.type],
    'OA': ev.type === 'OA_INVITE' ? 'Invited' : '',
    'Last Updated': dayOnly_(ev.date),
    'Source': 'Email',
    'Gmail Link': ev.link || '',
    'ID': id,
  };
}

function shouldGhost_(row, now) {
  if (String(row['Status']).trim() !== 'Submitted') return false;
  const dates = [row['Date Applied'], row['Last Updated']].filter(d => d instanceof Date);
  if (!dates.length) return false;
  const last = Math.max.apply(null, dates.map(d => d.getTime()));
  return now.getTime() - last > CONFIG.GHOST_DAYS * 24 * 3600 * 1000;
}
