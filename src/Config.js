// Settings you might want to change. Everything else reads from here.
const CONFIG = {
  // The old tracker. Read once during import, never written to.
  OLD_SHEET_ID: '1wGz4kQena6nJKODeTukxNq4VLj6bGU_piJ_IFcDVg4I',
  OLD_TABS: [
    { name: 'Internship & Job Tracker', cycle: 'Summer 2026' },
    { name: 'summer 2027', cycle: 'Summer 2027' },
  ],
  OLD_MISSING_TAB: 'Missing Applications',

  SCAN_START: new Date(2025, 9, 1), // Oct 1, 2025
  CYCLE_START_MONTH: 7, // July: applications from July 2026 on count toward "Summer 2027"
  GHOST_DAYS: 60,

  // Gemini free tier. Check https://aistudio.google.com/rate-limit for your actual limits.
  GEMINI_MODEL: 'gemini-3.5-flash-lite',
  GEMINI_MIN_INTERVAL_MS: 6000, // stays under ~10 requests/minute
  GEMINI_DAILY_LIMIT: 200,
  EMAILS_PER_REQUEST: 10,
  BODY_CHARS: 2000,

  RUN_BUDGET_MS: 3 * 60 * 1000, // Apps Script kills runs at 6 minutes; a batch can take over a minute
  TRIGGER_MINUTES: 15,
  SCAN_WINDOW_DAYS: 30,
  LABEL: 'JobTracker/Processed',

  SHEETS: { TRACKER: 'Tracker', REVIEW: 'Review', LOG: '_Processed', CHECK: 'Old List Check' },
};

// Tracker columns. The script finds these by header name, so they can be reordered,
// and you can add your own columns anywhere. Don't rename these headers.
const COLS = [
  'Cycle', 'Company', 'Position', 'Other Titles', 'Location', 'Date Applied', 'Status',
  'OA', 'Interview', 'Details', 'Applicant Portal', 'Last Updated', 'Source', 'Gmail Link', 'ID',
];

const REVIEW_COLS = [
  'Email Date', 'Type', 'Company', 'Title', 'Location', 'Subject', 'Gmail Link', 'Why',
  'Apply To', 'Action', 'Result', 'Message ID',
];

const STATUSES = ['Submitted', 'In Progress', 'Rejected', 'Ghosted', 'Offer'];
// Status only ever moves to a higher rank. Anything you type that isn't listed here is left alone.
const STATUS_RANK = { '': -1, 'Submitted': 0, 'Ghosted': 1, 'In Progress': 2, 'Rejected': 3, 'Offer': 4 };
const OA_VALUES = ['Invited', 'Completed', 'Passed', 'Failed', 'N/A'];
const INTERVIEW_VALUES = ['Invited', 'Scheduled', 'Completed', 'Passed', 'Failed', 'N/A'];

const EVENT_TYPES = { CONFIRMATION: 'Confirmation', REJECTION: 'Rejection', OA_INVITE: 'OA Invite' };
const EVENT_STATUS = { CONFIRMATION: 'Submitted', REJECTION: 'Rejected', OA_INVITE: 'In Progress' };
