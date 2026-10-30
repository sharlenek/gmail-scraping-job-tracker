// Reading and writing the Tracker tab. Rows are found by their hidden ID and columns by header
// name, so sorting, moving rows, and adding your own columns are all safe.

const SUMMARY_FIRST_ROW = 4;

function findHeaderRow_(sheet, required) {
  const n = Math.min(sheet.getLastRow(), 60);
  if (!n) return 0;
  const values = sheet.getRange(1, 1, n, Math.max(sheet.getLastColumn(), 1)).getValues();
  for (let i = 0; i < values.length; i++) {
    const cells = values[i].map(v => String(v).trim());
    if (required.every(h => cells.includes(h))) return i + 1;
  }
  return 0;
}

function headerMap_(sheet, headerRow, names, sheetName) {
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0].map(v => String(v).trim());
  const col = {};
  names.forEach(n => {
    const i = headers.indexOf(n);
    if (i < 0) throw new Error('Column "' + n + '" is missing from the ' + sheetName + ' header row. Put it back (any position) and run again.');
    col[n] = i + 1;
  });
  return col;
}

function loadTracker_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEETS.TRACKER);
  if (!sheet) throw new Error('No "' + CONFIG.SHEETS.TRACKER + '" tab. Run Job Tracker → First-time setup.');
  const headerRow = findHeaderRow_(sheet, ['Company', 'ID']);
  if (!headerRow) throw new Error('Can\'t find the Tracker header row (needs "Company" and "ID" headers).');
  const col = headerMap_(sheet, headerRow, COLS, 'Tracker');
  const lastCol = sheet.getLastColumn();
  const t = { sheet: sheet, headerRow: headerRow, col: col, lastCol: lastCol, rows: [], added: 0 };

  const lastRow = sheet.getLastRow();
  if (lastRow > headerRow) {
    const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
    values.forEach((v, i) => {
      const row = { _row: headerRow + 1 + i };
      COLS.forEach(n => { row[n] = v[col[n] - 1]; });
      if (!row['Company'] && !row['Position']) return;
      t.rows.push(row);
      if (!row['ID']) setCells_(t, row, { 'ID': newId_() }); // rows you added by hand
    });
  }
  return t;
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function setCells_(t, row, changes) {
  Object.keys(changes).forEach(name => {
    row[name] = changes[name];
    t.sheet.getRange(row._row, t.col[name]).setValue(changes[name]);
  });
}

function appendRows_(t, objs) {
  if (!objs.length) return;
  const start = Math.max(t.sheet.getLastRow(), t.headerRow) + 1;
  const values = objs.map((o, i) => {
    const line = new Array(t.lastCol).fill('');
    COLS.forEach(n => { if (o[n] !== undefined) line[t.col[n] - 1] = o[n]; });
    o._row = start + i;
    t.rows.push(o);
    return line;
  });
  t.sheet.getRange(start, 1, values.length, t.lastCol).setValues(values);
  t.added += objs.length;
}

function knownCompanies_(t) {
  const seen = {};
  t.rows.forEach(r => { if (r['Company']) seen[String(r['Company']).trim()] = true; });
  return Object.keys(seen).sort();
}

function sortTracker_(t) {
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= t.headerRow + 1) return;
  t.sheet.getRange(t.headerRow + 1, 1, lastRow - t.headerRow, t.lastCol).sort([
    { column: t.col['Cycle'], ascending: true },
    { column: t.col['Date Applied'], ascending: true },
  ]);
}

function colLetter_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

// Summary grid: one row per cycle × status, live COUNTIFS formulas, rewritten every run.
function writeSummary_(t) {
  const cycles = {};
  t.rows.forEach(r => { if (r['Cycle']) cycles[r['Cycle']] = true; });
  cycles[cycleFor_(new Date())] = true;
  const list = Object.keys(cycles).sort();

  const neededHeaderRow = SUMMARY_FIRST_ROW + list.length + 3; // header, cycles, total, blank
  if (t.headerRow < neededHeaderRow) {
    t.sheet.insertRowsBefore(t.headerRow, neededHeaderRow - t.headerRow);
    t.headerRow = neededHeaderRow;
    protectTop_(t);
  }
  const first = t.headerRow + 1;
  const range = name => colLetter_(t.col[name]) + first + ':' + colLetter_(t.col[name]);
  const cyc = range('Cycle');
  const st = range('Status');

  const header = ['Cycle'].concat(STATUSES, ['Total']);
  const body = list.map((c, i) => {
    const r = SUMMARY_FIRST_ROW + 1 + i;
    return [c].concat(
      STATUSES.map((s, j) => '=COUNTIFS(' + cyc + ',$A' + r + ',' + st + ',' + colLetter_(j + 2) + '$' + SUMMARY_FIRST_ROW + ')'),
      ['=COUNTIF(' + cyc + ',$A' + r + ')'],
    );
  });
  const total = ['All cycles'].concat(
    STATUSES.map((s, j) => '=COUNTIF(' + st + ',' + colLetter_(j + 2) + '$' + SUMMARY_FIRST_ROW + ')'),
    ['=COUNTA(' + range('Company') + ')'],
  );

  const area = t.sheet.getRange(SUMMARY_FIRST_ROW, 1, t.headerRow - SUMMARY_FIRST_ROW, header.length);
  area.clearContent().clearFormat();
  const grid = [header].concat(body, [total]);
  t.sheet.getRange(SUMMARY_FIRST_ROW, 1, grid.length, header.length).setValues(grid);
  t.sheet.getRange(SUMMARY_FIRST_ROW, 1, 1, header.length).setFontWeight('bold').setBackground('#e8eaed');
  t.sheet.getRange(SUMMARY_FIRST_ROW + grid.length - 1, 1, 1, header.length).setFontWeight('bold');
  return list;
}

function writeStatusLine_(t, cursor) {
  const tz = Session.getScriptTimeZone();
  const behind = cursor && Date.now() - cursor.getTime() > 5 * 24 * 3600 * 1000;
  t.sheet.getRange(2, 1).setValue(
    'Last run: ' + Utilities.formatDate(new Date(), tz, 'M/d/yyyy h:mm a') +
    (cursor ? '   ·   Gmail checked through: ' + Utilities.formatDate(cursor, tz, 'M/d/yyyy') : '') +
    (behind ? '   (still catching up on older emails)' : ''));
}

// Dropdowns and date formats, reapplied every run so they cover new rows.
function applyFormatting_(t, cycles) {
  const sheet = t.sheet;
  if (sheet.getMaxRows() < sheet.getLastRow() + 100) sheet.insertRowsAfter(sheet.getMaxRows(), 200);
  const n = sheet.getMaxRows() - t.headerRow;
  const colRange = name => sheet.getRange(t.headerRow + 1, t.col[name], n, 1);
  const list = values => SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();

  const next = 'Summer ' + (Number(/(\d{4})/.exec(cycleFor_(new Date()))[1]) + 1);
  colRange('Cycle').setDataValidation(list(cycles.concat(cycles.includes(next) ? [] : [next])));
  colRange('Status').setDataValidation(list(STATUSES));
  colRange('OA').setDataValidation(list(OA_VALUES));
  colRange('Interview').setDataValidation(list(INTERVIEW_VALUES));
  colRange('Date Applied').setNumberFormat('M/d/yyyy');
  colRange('Last Updated').setNumberFormat('M/d/yyyy');
  applyColors_(t, n);
}

// Same colors as the old tracker. Earlier rules win, so OA/Interview cell colors sit on top of row colors.
const RESULT_COLORS = [['Failed', '#e06666'], ['Not Completed', '#ffd966'], ['Passed', '#6aa84f'], ['Completed', '#b6d7a8']];
const ROW_COLORS = [
  ['Offer', '#6aa84f', true],
  ['In Progress + Interview', '#b6d7a8'],
  ['In Progress', '#ffd966'],
  ['Submitted', '#76a5af'],
  ['Rejected', '#e06666'],
  ['Ghosted', '#e06666'],
];

// Replaces only the script's own color rules; conditional formatting you add is kept.
function applyColors_(t, n) {
  const first = t.headerRow + 1;
  const status = '$' + colLetter_(t.col['Status']) + first;
  const interview = '$' + colLetter_(t.col['Interview']) + first;
  const resultCols = [t.col['OA'], t.col['Interview']];

  const isOurs = rule => {
    const c = rule.getBooleanCondition();
    if (!c) return false;
    const v = String(c.getCriteriaValues()[0] || '');
    if (c.getCriteriaType() === SpreadsheetApp.BooleanCriteria.TEXT_CONTAINS) {
      return RESULT_COLORS.some(rc => rc[0] === v) &&
        rule.getRanges().every(r => resultCols.includes(r.getColumn()) && r.getNumColumns() === 1);
    }
    return c.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA &&
      /^=(AND\()?\$[A-Z]+\d+="(Submitted|In Progress|Rejected|Ghosted|Offer)"/.test(v);
  };

  const rules = [];
  RESULT_COLORS.forEach(([text, color]) => rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains(text).setBackground(color)
    .setRanges(resultCols.map(c => t.sheet.getRange(first, c, n, 1))).build()));
  const rowRange = t.sheet.getRange(first, 1, n, t.lastCol);
  ROW_COLORS.forEach(([name, color, bold]) => {
    const formula = name === 'In Progress + Interview'
      ? '=AND(' + status + '="In Progress",' + interview + '<>"")'
      : '=' + status + '="' + name + '"';
    const b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(color).setRanges([rowRange]);
    if (bold) b.setBold(true);
    rules.push(b.build());
  });

  const kept = t.sheet.getConditionalFormatRules().filter(r => !isOurs(r));
  t.sheet.setConditionalFormatRules(rules.concat(kept));
}

function protectTop_(t) {
  const sheet = t.sheet;
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(p => p.getDescription() === 'Job Tracker header')
    .forEach(p => p.remove());
  sheet.getRange(1, 1, t.headerRow, sheet.getMaxColumns()).protect()
    .setDescription('Job Tracker header')
    .setWarningOnly(true);
}

function buildTrackerSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEETS.TRACKER);
  if (sheet && findHeaderRow_(sheet, ['Company', 'ID'])) return sheet;
  if (!sheet) {
    const blank = ss.getSheets().find(s => s.getLastRow() === 0);
    sheet = blank ? blank.setName(CONFIG.SHEETS.TRACKER) : ss.insertSheet(CONFIG.SHEETS.TRACKER, 0);
  }
  const headerRow = SUMMARY_FIRST_ROW + 5;
  sheet.getRange(1, 1).setValue('Internship & Job Tracker').setFontSize(16).setFontWeight('bold');
  sheet.getRange(2, 1).setValue('Not run yet').setFontColor('#5f6368');
  sheet.getRange(headerRow, 1, 1, COLS.length).setValues([COLS])
    .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  const widths = { 'Cycle': 110, 'Company': 150, 'Position': 300, 'Other Titles': 180, 'Location': 130,
    'Date Applied': 100, 'Status': 100, 'OA': 90, 'Interview': 90, 'Details': 280,
    'Applicant Portal': 160, 'Last Updated': 100, 'Source': 80, 'Gmail Link': 120 };
  COLS.forEach((n, i) => { if (widths[n]) sheet.setColumnWidth(i + 1, widths[n]); });
  sheet.hideColumns(COLS.indexOf('ID') + 1);
  return sheet;
}
