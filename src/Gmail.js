// Gmail search that narrows the inbox to likely job emails before Gemini sees anything.
const SEARCH_TERMS = '{' + [
  '"thank you for applying"', '"thanks for applying"', '"application received"', '"received your application"',
  '"your application"', '"application confirmation"', '"application submitted"', '"interest in"',
  '"other candidates"', '"move forward"', '"moving forward"', '"unfortunately"',
  '"online assessment"', '"coding challenge"', '"assessment"', 'hackerrank', 'codesignal', 'hirevue',
  'from:greenhouse-mail.io', 'from:greenhouse.io', 'from:lever.co', 'from:ashbyhq.com', 'from:myworkday.com',
  'from:icims.com', 'from:smartrecruiters.com', 'from:successfactors.com', 'from:taleo.net', 'from:jobvite.com',
  'from:workablemail.com', 'from:joinhandshake.com', 'from:jobs-noreply@linkedin.com',
  'from:hackerrankforwork.com', 'from:codesignal.com', 'from:hirevue.com',
].join(' ') + '} -in:sent -in:chats -in:spam -in:trash';

const DAY_MS = 24 * 3600 * 1000;

function gmailDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy/MM/dd');
}

/** Unprocessed messages dated within [from, to), oldest first. */
function collectMessages_(from, to, processed) {
  // One extra day on each side covers Gmail's date-boundary quirks; the processed log removes repeats.
  const query = 'after:' + gmailDate_(new Date(from.getTime() - DAY_MS)) +
    ' before:' + gmailDate_(new Date(to.getTime() + DAY_MS)) + ' ' + SEARCH_TERMS;
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const threads = GmailApp.search(query, offset, 100);
    if (!threads.length) break;
    GmailApp.getMessagesForThreads(threads).forEach(msgs => msgs.forEach(m => {
      const d = m.getDate();
      if (d >= from && d < to && !processed.has(m.getId())) out.push(m);
    }));
    if (threads.length < 100) break;
  }
  return out.sort((a, b) => a.getDate() - b.getDate());
}

function emailForGemini_(m, id) {
  return {
    id: id,
    from: m.getFrom(),
    subject: m.getSubject(),
    date: m.getDate().toDateString(),
    body: m.getPlainBody().replace(/\s+/g, ' ').slice(0, CONFIG.BODY_CHARS),
  };
}

function gmailLink_(m) {
  return 'https://mail.google.com/mail/u/0/#all/' + m.getId();
}

function trackerLabel_() {
  return GmailApp.getUserLabelByName(CONFIG.LABEL) || GmailApp.createLabel(CONFIG.LABEL);
}

/**
 * Walks Gmail forward from the saved cursor in windows, classifying in batches until the time budget
 * runs out. Returns the new cursor (everything before it has been processed).
 */
function scanGmail_(ctx, startedAt) {
  const props = PropertiesService.getScriptProperties();
  let cursor = props.getProperty('scanCursor') ? new Date(Number(props.getProperty('scanCursor'))) : CONFIG.SCAN_START;
  const now = new Date();
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const label = trackerLabel_();
  const timeLeft = () => Date.now() - startedAt < CONFIG.RUN_BUDGET_MS;

  while (timeLeft()) {
    const windowEnd = new Date(Math.min(cursor.getTime() + CONFIG.SCAN_WINDOW_DAYS * DAY_MS, now.getTime()));
    const messages = collectMessages_(cursor, windowEnd, ctx.processed);
    let i = 0;
    try {
      while (i < messages.length && timeLeft()) {
        const batch = messages.slice(i, i + CONFIG.EMAILS_PER_REQUEST);
        const mine = batch.filter(m => m.getFrom().toLowerCase().includes(me));
        const theirs = batch.filter(m => !mine.includes(m));
        mine.forEach(m => logProcessed_(ctx, m, 'OTHER', '', '', 'Skipped: sent by you'));
        const results = theirs.length
          ? classifyEmails_(theirs.map((m, k) => emailForGemini_(m, 'e' + k)), knownCompanies_(ctx.t))
          : {};
        theirs.forEach((m, k) => handleMessage_(ctx, m, results['e' + k], label));
        flushLog_(ctx);
        i += batch.length;
      }
    } catch (e) {
      flushLog_(ctx);
      if (!(e instanceof GeminiLimitError)) throw e;
      Logger.log('Stopping early: ' + e.message);
      ctx.stoppedEarly = true;
    }
    if (i < messages.length) { // ran out of time or quota mid-window
      cursor = messages[i].getDate();
      break;
    }
    if (windowEnd.getTime() >= now.getTime()) {
      // Caught up. Re-check the last 3 days next time in case of late-arriving mail.
      cursor = new Date(now.getTime() - 3 * DAY_MS);
      break;
    }
    cursor = windowEnd;
  }
  props.setProperty('scanCursor', String(cursor.getTime()));
  return cursor;
}

function handleMessage_(ctx, m, r, label) {
  if (!r) {
    const ev = eventFromMessage_(m, { type: 'CONFIRMATION', company: '', title: '', location: '' });
    addReview_(ctx, ev, 'Gemini didn\'t return a result for this email', []);
    logProcessed_(ctx, m, '', '', '', 'Sent to Review');
    m.getThread().addLabel(label);
    return;
  }
  if (r.type === 'OTHER') {
    logProcessed_(ctx, m, 'OTHER', r.company, r.title, 'Skipped: not an application update');
    return;
  }
  const ev = eventFromMessage_(m, r);
  const outcome = !r.company || !r.confident
    ? (addReview_(ctx, ev, 'Not sure what this email is', candidatesForCompany_(ctx, ev)), 'Sent to Review')
    : applyEvent_(ctx, ev);
  logProcessed_(ctx, m, r.type, r.company, r.title, outcome);
  m.getThread().addLabel(label);
}

function eventFromMessage_(m, r) {
  return {
    type: r.type,
    company: (r.company || '').trim(),
    title: (r.title || '').trim(),
    location: (r.location || '').trim(),
    date: m.getDate(),
    subject: m.getSubject(),
    link: gmailLink_(m),
    messageId: m.getId(),
  };
}
