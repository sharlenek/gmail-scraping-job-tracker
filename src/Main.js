// The 15-minute run: apply your Review choices, scan Gmail, mark ghosted rows, refresh the summary.
function runTracker() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) return 'Another run is already in progress.';
  try {
    const startedAt = Date.now();
    const ctx = loadContext_();
    applyReviewChoices_(ctx);
    const cursor = scanGmail_(ctx, startedAt);
    markGhosted_(ctx);
    finishRun_(ctx, cursor);
    return ctx.t.added + ' row(s) added, ' + ctx.updated + ' updated, ' + ctx.reviewed + ' sent to Review.' +
      (ctx.stoppedEarly ? ' Stopped early for the Gemini rate limit; it will continue next run.' : '');
  } finally {
    lock.releaseLock();
  }
}

function loadContext_() {
  const ctx = { t: loadTracker_(), log: [], updated: 0, reviewed: 0, processed: new Set() };
  const log = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEETS.LOG);
  if (log.getLastRow() > 1) {
    log.getRange(2, 1, log.getLastRow() - 1, 1).getValues().forEach(v => ctx.processed.add(String(v[0])));
  }
  return ctx;
}

function finishRun_(ctx, cursor) {
  if (ctx.t.added) sortTracker_(ctx.t);
  const cycles = writeSummary_(ctx.t);
  applyFormatting_(ctx.t, cycles);
  writeStatusLine_(ctx.t, cursor);
}

/** Applies an email event to the tracker. Returns a short description for the log. */
function applyEvent_(ctx, ev) {
  const decision = matchEvent_(ctx.t.rows, ev, pickRow_);
  if (decision.action === 'review') {
    addReview_(ctx, ev, decision.reason, decision.candidates);
    return 'Sent to Review';
  }
  if (decision.action === 'update') return updateRow_(ctx, decision.row, ev);
  return createRow_(ctx, ev);
}

function updateRow_(ctx, row, ev) {
  const changes = changesForEvent_(row, ev);
  if (!Object.keys(changes).length) return 'No change to #' + row['ID'];
  setCells_(ctx.t, row, changes);
  ctx.updated++;
  return 'Updated #' + row['ID'] + ' (' + Object.keys(changes).join(', ') + ')';
}

function createRow_(ctx, ev) {
  const row = newRowForEvent_(ev, newId_());
  appendRows_(ctx.t, [row]);
  return 'Added #' + row['ID'];
}

function markGhosted_(ctx) {
  const now = new Date();
  ctx.t.rows.filter(r => shouldGhost_(r, now)).forEach(r => setCells_(ctx.t, r, { 'Status': 'Ghosted' }));
}

function candidatesForCompany_(ctx, ev) {
  if (!ev.company) return [];
  const cycle = cycleFor_(ev.date);
  const c = normCompany_(ev.company);
  return ctx.t.rows.filter(r => normCompany_(r['Company']) === c &&
    (r['Cycle'] === cycle || r['Cycle'] === previousCycle_(cycle)));
}

// ---- Processed-email log (hidden tab) ----

function logProcessed_(ctx, m, type, company, title, outcome) {
  ctx.processed.add(m.getId());
  ctx.log.push([m.getId(), m.getDate(), new Date(), type, company, title, m.getSubject(), outcome]);
}

function flushLog_(ctx) {
  if (!ctx.log.length) return;
  const log = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEETS.LOG);
  log.getRange(log.getLastRow() + 1, 1, ctx.log.length, ctx.log[0].length).setValues(ctx.log);
  ctx.log = [];
}
