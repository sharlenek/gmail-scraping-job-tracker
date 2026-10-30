// The Review tab: emails the script wasn't sure about. Pick an Action (and optionally a row in
// "Apply To"); the next run applies it. You can also correct Type/Company/Title/Location first.

function loadReview_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEETS.REVIEW);
  return { sheet: sheet, col: headerMap_(sheet, 1, REVIEW_COLS, 'Review') };
}

function addReview_(ctx, ev, reason, candidates) {
  const rv = ctx.review || (ctx.review = loadReview_());
  const r = rv.sheet.getLastRow() + 1;
  const line = new Array(rv.sheet.getLastColumn()).fill('');
  const set = (n, v) => { line[rv.col[n] - 1] = v; };
  set('Email Date', dayOnly_(ev.date));
  set('Type', EVENT_TYPES[ev.type] || '');
  set('Company', ev.company);
  set('Title', ev.title);
  set('Location', ev.location);
  set('Subject', ev.subject);
  set('Gmail Link', ev.link);
  set('Why', reason);
  set('Message ID', ev.messageId);
  rv.sheet.getRange(r, 1, 1, line.length).setValues([line]);

  const options = ['New row'].concat(candidates.map(rowLabel_));
  rv.sheet.getRange(r, rv.col['Apply To']).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(true).build());
  rv.sheet.getRange(r, rv.col['Action']).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Apply', 'Ignore'], true).build());
  rv.sheet.getRange(r, rv.col['Type']).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(Object.values(EVENT_TYPES), true).build());
  ctx.reviewed++;
}

function applyReviewChoices_(ctx) {
  const rv = loadReview_();
  ctx.review = rv;
  const n = rv.sheet.getLastRow() - 1;
  if (n < 1) return;
  const values = rv.sheet.getRange(2, 1, n, rv.sheet.getLastColumn()).getValues();
  const typeCode = {};
  Object.keys(EVENT_TYPES).forEach(k => { typeCode[EVENT_TYPES[k]] = k; });

  values.forEach((v, i) => {
    const get = name => v[rv.col[name] - 1];
    const action = String(get('Action')).trim();
    if (!action || String(get('Result')).trim()) return;
    const resultCell = rv.sheet.getRange(i + 2, rv.col['Result']);
    if (action === 'Ignore') { resultCell.setValue('Ignored'); return; }

    const type = typeCode[String(get('Type')).trim()];
    if (!type) { resultCell.setValue('Pick a Type first, then clear this cell'); return; }
    const date = get('Email Date') instanceof Date ? get('Email Date') : new Date();
    const ev = {
      type: type,
      company: String(get('Company')).trim(),
      title: String(get('Title')).trim(),
      location: String(get('Location')).trim(),
      date: date,
      subject: String(get('Subject')),
      link: String(get('Gmail Link')),
      messageId: String(get('Message ID')),
    };
    const id = idFromLabel_(get('Apply To'));
    if (id) {
      const row = ctx.t.rows.find(r => String(r['ID']) === id);
      resultCell.setValue(row ? updateRow_(ctx, row, ev) : 'Row #' + id + ' not found');
    } else if (!ev.company) {
      resultCell.setValue('Fill in Company first, then clear this cell');
    } else {
      resultCell.setValue(createRow_(ctx, ev));
    }
  });
}

function buildReviewSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEETS.REVIEW);
  if (sheet) return sheet;
  sheet = ss.insertSheet(CONFIG.SHEETS.REVIEW);
  sheet.getRange(1, 1, 1, REVIEW_COLS.length).setValues([REVIEW_COLS])
    .setFontWeight('bold').setBackground('#f9ab00');
  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat('M/d/yyyy');
  sheet.setColumnWidth(REVIEW_COLS.indexOf('Subject') + 1, 300);
  sheet.setColumnWidth(REVIEW_COLS.indexOf('Apply To') + 1, 320);
  sheet.setColumnWidth(REVIEW_COLS.indexOf('Why') + 1, 260);
  sheet.hideColumns(REVIEW_COLS.indexOf('Message ID') + 1);
  return sheet;
}
