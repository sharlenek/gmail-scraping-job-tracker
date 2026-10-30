class GeminiLimitError extends Error {}

function geminiJson_(prompt, schema) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('No Gemini API key. Use Job Tracker → Set Gemini API key.');

  // Free-tier daily quota resets at midnight Pacific.
  const today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  const count = props.getProperty('geminiDay') === today ? Number(props.getProperty('geminiCount') || 0) : 0;
  if (count >= CONFIG.GEMINI_DAILY_LIMIT) throw new GeminiLimitError('Daily Gemini limit reached');

  const wait = Number(props.getProperty('geminiLastCall') || 0) + CONFIG.GEMINI_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) Utilities.sleep(wait);

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + CONFIG.GEMINI_MODEL + ':generateContent';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
    }),
  });
  props.setProperties({ geminiDay: today, geminiCount: String(count + 1), geminiLastCall: String(Date.now()) });

  const code = res.getResponseCode();
  if (code === 429) throw new GeminiLimitError('Gemini rate limit (429)');
  if (code !== 200) throw new Error('Gemini error ' + code + ': ' + res.getContentText().slice(0, 500));
  const body = JSON.parse(res.getContentText());
  const text = body.candidates && body.candidates[0] && body.candidates[0].content.parts.map(p => p.text || '').join('');
  if (!text) throw new Error('Gemini returned no content: ' + res.getContentText().slice(0, 500));
  return JSON.parse(text);
}

const CLASSIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    emails: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          type: { type: 'STRING', enum: ['CONFIRMATION', 'REJECTION', 'OA_INVITE', 'OTHER'] },
          company: { type: 'STRING' },
          title: { type: 'STRING' },
          location: { type: 'STRING' },
          confident: { type: 'BOOLEAN' },
        },
        required: ['id', 'type', 'company', 'title', 'location', 'confident'],
      },
    },
  },
  required: ['emails'],
};

/** emails: [{ id, from, subject, date, body }]. Returns a map id → classification. */
function classifyEmails_(emails, knownCompanies) {
  const prompt = [
    'You maintain a student\'s internship/job application tracker from their Gmail.',
    'Classify each email below:',
    '- CONFIRMATION: confirms that an application was received or submitted. Includes LinkedIn',
    '  "your application was sent to ..." and Handshake "application submitted" emails.',
    '- REJECTION: the application was declined, is not moving forward, or the position was filled or closed.',
    '- OA_INVITE: an invitation or reminder to complete an online assessment, coding challenge,',
    '  HireVue/video assessment, or skills test (HackerRank, CodeSignal, etc.).',
    '- OTHER: everything else, including interview invitations or scheduling, offers, job alerts or',
    '  recommendations, recruiter outreach, newsletters, events, account or password emails, and',
    '  "finish your application" reminders.',
    '',
    'Fields:',
    '- company: the hiring employer, never the platform (not Workday, Greenhouse, Lever, Ashby,',
    '  iCIMS, LinkedIn, Handshake, HackerRank...). If it is the same employer as one in the known',
    '  companies list, copy that exact spelling.',
    '- title: the job title exactly as the email states it, including term/req ID text. "" if not stated.',
    '- location: as stated in the email, "" if not stated.',
    '- confident: false if you are unsure of the type or the company.',
    'For OTHER emails, company/title/location may be "".',
    '',
    'Known companies: ' + JSON.stringify(knownCompanies),
    '',
    'Emails:',
    JSON.stringify(emails),
  ].join('\n');
  const out = geminiJson_(prompt, CLASSIFY_SCHEMA);
  const byId = {};
  (out.emails || []).forEach(e => { byId[e.id] = e; });
  return byId;
}

const PICK_SCHEMA = {
  type: 'OBJECT',
  properties: { match: { type: 'INTEGER' }, confident: { type: 'BOOLEAN' } },
  required: ['match', 'confident'],
};

/** Asks Gemini which candidate row (if any) the email is about. */
function pickRow_(ev, candidates) {
  const rules = ev.type === 'CONFIRMATION'
    ? 'This is a new application confirmation. Only match a row the student typed by hand for this same ' +
      'role (they use shorthand, e.g. "swe intern" = "Software Engineer Intern"). A different role at the ' +
      'same company is NOT a match.'
    : 'This is a ' + EVENT_TYPES[ev.type] + ' email. Its job title may be worded slightly differently from ' +
      'the row (added term, req ID, shorthand). Match the row for the same application.';
  const prompt = [
    'Match an email to a row in a job application tracker. ' + rules,
    'Answer match = the row number n, or 0 if none of the rows is the same application.',
    'Set confident = false if it could reasonably be more than one row or you cannot tell.',
    '',
    'Email: ' + JSON.stringify({ company: ev.company, title: ev.title, location: ev.location, subject: ev.subject, date: ev.date.toDateString() }),
    'Rows: ' + JSON.stringify(candidates.map((r, i) => ({
      n: i + 1,
      position: r['Position'],
      otherTitles: r['Other Titles'],
      location: r['Location'],
      dateApplied: r['Date Applied'] instanceof Date ? r['Date Applied'].toDateString() : '',
      status: r['Status'],
      notes: r['Details'],
    }))),
  ].join('\n');
  const out = geminiJson_(prompt, PICK_SCHEMA);
  const row = out.match >= 1 && out.match <= candidates.length ? candidates[out.match - 1] : null;
  return { row: row, confident: !!out.confident };
}
