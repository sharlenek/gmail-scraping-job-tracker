function onOpen() {
  SpreadsheetApp.getUi().createMenu('Job Tracker')
    .addItem('Run now', 'menuRunNow')
    .addSeparator()
    .addItem('First-time setup', 'setup')
    .addItem('Set Gemini API key…', 'setGeminiKey')
    .addItem('Check against old "Missing Applications" list', 'checkAgainstOldList')
    .addSeparator()
    .addItem('Stop automatic runs', 'stopTriggers')
    .addToUi();
}

function setup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GEMINI_API_KEY')) setGeminiKey();
  if (!props.getProperty('GEMINI_API_KEY')) return;

  const ss = SpreadsheetApp.getActive();
  buildTrackerSheet_(ss);
  buildReviewSheet_(ss);
  if (!ss.getSheetByName(CONFIG.SHEETS.LOG)) {
    const log = ss.insertSheet(CONFIG.SHEETS.LOG);
    log.appendRow(['Message ID', 'Email Date', 'Processed At', 'Type', 'Company', 'Title', 'Subject', 'Outcome']);
    log.hideSheet();
  }

  const t = loadTracker_();
  const imported = importOldTracker_(t);
  const ctx = { t: t };
  finishRun_(ctx, null);
  protectTop_(t);
  trackerLabel_();

  stopTriggers(true);
  ScriptApp.newTrigger('runTracker').timeBased().everyMinutes(CONFIG.TRIGGER_MINUTES).create();

  ui.alert('Setup done. Imported ' + imported + ' rows from your old tracker.\n\n' +
    'Gmail scanning runs every ' + CONFIG.TRIGGER_MINUTES + ' minutes. The first catch-up from Oct 2025 ' +
    'takes a day or two on the free Gemini tier. Use Job Tracker → Run now to start right away.');
}

function setGeminiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Gemini API key', 'Paste your key from https://aistudio.google.com/apikey', ui.ButtonSet.OK_CANCEL);
  const key = res.getResponseText().trim();
  if (res.getSelectedButton() === ui.Button.OK && key) {
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
    ui.alert('Saved.');
  }
}

function menuRunNow() {
  SpreadsheetApp.getUi().alert(runTracker());
}

function stopTriggers(quiet) {
  ScriptApp.getProjectTriggers()
    .filter(tr => tr.getHandlerFunction() === 'runTracker')
    .forEach(tr => ScriptApp.deleteTrigger(tr));
  if (quiet !== true) SpreadsheetApp.getUi().alert('Automatic runs stopped. Run First-time setup to turn them back on.');
}
