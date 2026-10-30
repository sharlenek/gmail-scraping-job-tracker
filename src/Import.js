// One-time copy of the old tracker's rows. The old spreadsheet is only read.

function importOldTracker_(t) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('imported')) return 0;
  const old = SpreadsheetApp.openById(CONFIG.OLD_SHEET_ID);
  // Read dates in the old sheet's own time zone, or they can shift by a day.
  const oldTz = old.getSpreadsheetTimeZone();
  const rows = [];

  CONFIG.OLD_TABS.forEach(tab => {
    const sheet = old.getSheetByName(tab.name);
    if (!sheet) throw new Error('Old tab "' + tab.name + '" not found.');
    const values = sheet.getDataRange().getValues();
    const h = values.findIndex(r => r.map(v => String(v).trim()).includes('Company') &&
      r.map(v => String(v).trim()).includes('Position'));
    if (h < 0) throw new Error('No Company/Position header in old tab "' + tab.name + '".');
    const idx = {};
    values[h].forEach((v, i) => { idx[String(v).trim().toLowerCase()] = i; });
    const get = (r, name) => (name in idx ? r[idx[name]] : '');

    values.slice(h + 1).forEach(r => {
      const company = String(get(r, 'company')).trim();
      if (!company) return;
      let rawDate = get(r, 'date applied');
      if (rawDate instanceof Date) rawDate = Utilities.formatDate(rawDate, oldTz, 'M/d/yyyy');
      const date = parseOldDate_(rawDate, tab.cycle);
      const status = mapOldStatus_(get(r, 'application status'));
      const notes = [String(get(r, 'details')).trim()];
      if (status.note) notes.push(status.note);
      if (rawDate && !date) notes.push('old date: ' + rawDate);
      rows.push({
        'Cycle': date ? cycleFor_(date) : tab.cycle,
        'Company': company,
        'Position': String(get(r, 'position')).trim(),
        'Date Applied': date || '',
        'Status': status.status,
        'OA': String(get(r, 'oa')).trim(),
        'Interview': String(get(r, 'interview')).trim() || status.interview || '',
        'Details': notes.filter(Boolean).join(' | '),
        'Applicant Portal': String(get(r, 'applicant portal')).trim(),
        'Source': 'Manual',
        'ID': newId_(),
      });
    });
  });

  appendRows_(t, rows);
  sortTracker_(t);
  props.setProperty('imported', new Date().toISOString());
  return rows.length;
}

/**
 * Clears the new tracker's rows, Review items and email log, then re-imports the old tracker and
 * rescans Gmail from the start. Erases any edits made in the new sheet. The old sheet is not touched.
 */
function resetAndReimport() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset the new tracker?', 'This erases all rows in Tracker and Review (including edits you made here), ' +
    're-imports your old tracker, and rescans Gmail from Oct 2025. Your old sheet is not touched.',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(6 * 60 * 1000); // wait for any running scan to finish
  try {
    const ss = SpreadsheetApp.getActive();
    const t = loadTracker_();
    if (t.sheet.getLastRow() > t.headerRow) t.sheet.deleteRows(t.headerRow + 1, t.sheet.getLastRow() - t.headerRow);
    [CONFIG.SHEETS.REVIEW, CONFIG.SHEETS.LOG].forEach(name => {
      const s = ss.getSheetByName(name);
      if (s.getLastRow() > 1) s.deleteRows(2, s.getLastRow() - 1);
    });
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('imported');
    props.deleteProperty('scanCursor');
    const fresh = loadTracker_();
    const n = importOldTracker_(fresh);
    finishRun_({ t: fresh }, null);
    ui.alert('Re-imported ' + n + ' rows. Gmail scanning restarts on the next run.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Compares the old "Missing Applications" list with what the new tracker did with each email,
 * so you can confirm nothing was missed. Writes an "Old List Check" tab you can delete afterwards.
 */
function checkAgainstOldList() {
  const old = SpreadsheetApp.openById(CONFIG.OLD_SHEET_ID).getSheetByName(CONFIG.OLD_MISSING_TAB);
  const values = old.getDataRange().getValues();
  const head = values[0].map(v => String(v).trim());
  const linkCol = head.indexOf('Gmail Link');

  const outcomes = {};
  const log = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEETS.LOG);
  if (log.getLastRow() > 1) {
    log.getRange(2, 1, log.getLastRow() - 1, 8).getValues()
      .forEach(r => { outcomes[String(r[0])] = r[7] + (r[4] ? ' — ' + r[4] + (r[5] ? ': ' + r[5] : '') : ''); });
  }

  const out = [head.slice(0, 5).concat(['New tracker result'])];
  let missing = 0;
  values.slice(1).forEach(r => {
    if (!r[0] && !r[1]) return;
    const id = String(r[linkCol] || '').split('/').pop();
    const result = outcomes[id] || 'NOT SCANNED (search missed it, or the backfill hasn\'t reached it yet)';
    if (!outcomes[id]) missing++;
    out.push(r.slice(0, 5).concat([result]));
  });

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CHECK) || ss.insertSheet(CONFIG.SHEETS.CHECK);
  sheet.clear();
  sheet.getRange(1, 1, out.length, out[0].length).setValues(out);
  sheet.getRange(1, 1, 1, out[0].length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  SpreadsheetApp.getUi().alert((out.length - 1) + ' emails on the old list, ' + missing + ' not scanned yet. See the "' + CONFIG.SHEETS.CHECK + '" tab.');
}
