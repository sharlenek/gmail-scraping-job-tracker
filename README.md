# Gmail → Google Sheets job tracker

An Apps Script bound to a Google Sheet. Every 15 minutes it reads new job emails from Gmail and
uses Gemini (free tier) to update the **Tracker** tab:

| Email | What happens |
|---|---|
| Application confirmation (incl. LinkedIn / Handshake) | New row, Status = Submitted (or links to a row you typed by hand) |
| Online assessment invite | OA = Invited, Status = In Progress |
| Rejection | Status = Rejected (creates the row if it's missing) |
| 60 days of silence | Submitted → Ghosted |

Interviews and offers are manual. Emails it isn't sure about go to the **Review** tab: choose
**Apply** or **Ignore** in the Action column, and optionally a row in **Apply To**. The next run carries it out.

Cycles are assigned by application date and start every July 1 (`CONFIG.CYCLE_START_MONTH` in `src/Config.js`).

## Editing the sheet yourself

**Safe:** sorting, filtering, editing any cell, adding or deleting rows, adding your own columns,
and reordering columns. The script finds rows by a hidden ID and columns by header name. It never
overwrites what you typed, with one exception: an email's official job title replaces shorthand
on a row you typed by hand.

**Avoid:** renaming the script's column headers, and editing the summary grid at the top (it's rebuilt every run).

**Merging two rows for the same role:** paste the extra row's title into the kept row's
**Other Titles** cell (separate several with `;`), then delete the extra row. Future emails using
either title will update the kept row.

**Deleting a row:** if a new email about that application arrives later, the row comes back.
To retire a row for good, change its Status instead of deleting it.

## Setup (one time)

1. Turn on the Apps Script API for your personal account: https://script.google.com/home/usersettings
2. Log clasp in to your **personal** Google account. A named login keeps any other clasp accounts untouched:
   ```sh
   clasp login --user personal
   ```
3. Create the sheet and push the code:
   ```sh
   clasp --user personal create --type sheets --title "Job Tracker (auto)" --rootDir src
   clasp --user personal push
   ```
4. Get a Gemini API key at https://aistudio.google.com/apikey.
5. Open the new sheet and reload it. Click **Job Tracker → First-time setup**, approve the
   permissions, and paste the key when asked. Setup builds the tabs, imports your old tracker,
   and starts the 15-minute timer.
6. Click **Job Tracker → Run now** to start catching up. Catching up from Oct 2025 takes about
   1–2 days on the free tier. The line under the title shows how far it has reached.
7. Once it has caught up, click **Job Tracker → Check against old "Missing Applications" list**
   to confirm every email the old script found was handled.
8. In the old sheet, open **Extensions → Apps Script → Triggers** (clock icon) and delete the old script's trigger.

## Development

- `npm test` runs the local tests of the matching and date logic (`tests/`).
- `clasp --user personal push` deploys changes.
- Settings (Gemini model, daily limit, ghost days, scan start) are in `src/Config.js`.
- The Gemini key is stored in Script Properties, never in the code.
