// Tests the pure logic in src/Util.js (no Google services needed). Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({});
for (const f of ['Config.js', 'Util.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx);
}
const run = code => vm.runInContext(code, ctx);
const fn = name => run(name);
const D = (y, m, d) => run(`new Date(${y}, ${m - 1}, ${d})`);

const row = (o) => Object.assign({
  'Cycle': 'Summer 2027', 'Company': 'Acme', 'Position': '', 'Other Titles': '', 'Location': '',
  'Date Applied': '', 'Status': 'Submitted', 'OA': '', 'Gmail Link': '', 'Details': '', 'ID': 'x',
}, o);
const noPick = () => { throw new Error('pick should not be called'); };

test('cycles roll over on July 1', () => {
  assert.strictEqual(fn('cycleFor_')(D(2026, 6, 30)), 'Summer 2026');
  assert.strictEqual(fn('cycleFor_')(D(2026, 7, 1)), 'Summer 2027');
  assert.strictEqual(fn('cycleFor_')(D(2025, 11, 3)), 'Summer 2026');
  assert.strictEqual(fn('previousCycle_')('Summer 2027'), 'Summer 2026');
});

test('old dates parse, including ones without a year', () => {
  const p = fn('parseOldDate_');
  assert.strictEqual(p('2/25/26', 'Summer 2026').getTime(), D(2026, 2, 25).getTime());
  assert.strictEqual(p('3/15/2026', 'Summer 2026').getTime(), D(2026, 3, 15).getTime());
  assert.strictEqual(p('11/4', 'Summer 2026').getTime(), D(2025, 11, 4).getTime());
  assert.strictEqual(p('7/20', 'Summer 2027').getTime(), D(2026, 7, 20).getTime());
  assert.strictEqual(p('', 'Summer 2027'), null);
  assert.strictEqual(p('sometime', 'Summer 2027'), null);
});

test('old statuses map onto the new set', () => {
  const m = fn('mapOldStatus_');
  assert.strictEqual(m('Interview').status, 'In Progress');
  assert.strictEqual(m('Interview').interview, 'Invited');
  assert.strictEqual(m('').status, 'Submitted');
  assert.match(m('Withdrawn').note, /Withdrawn/);
});

test('company names normalize', () => {
  const n = fn('normCompany_');
  assert.strictEqual(n('Lockheed Martin Corp.'), n('lockheed martin'));
  assert.strictEqual(n('Expedia Group'), n('Expedia'));
  assert.strictEqual(n('AT&T'), n('AT and T'));
});

test('duplicate confirmation updates the same row', () => {
  const r = row({ 'Position': 'Software Engineer Intern', 'Gmail Link': 'l' });
  const ev = { type: 'CONFIRMATION', company: 'Acme Inc', title: 'software engineer intern', location: '', date: D(2026, 9, 1) };
  const d = fn('matchEvent_')([r], ev, noPick);
  assert.strictEqual(d.action, 'update');
  assert.strictEqual(d.row, r);
});

test('slightly different confirmation title is a new row', () => {
  const r = row({ 'Position': 'Software Engineer Intern', 'Gmail Link': 'l' });
  const ev = { type: 'CONFIRMATION', company: 'Acme', title: 'Software Engineer Intern - Summer 2027', location: '', date: D(2026, 9, 1) };
  assert.strictEqual(fn('matchEvent_')([r], ev, noPick).action, 'create');
});

test('Other Titles count as a match (manual merge)', () => {
  const r = row({ 'Position': 'Software Engineer Intern', 'Other Titles': 'SWE Intern - Summer 2027', 'Gmail Link': 'l' });
  const ev = { type: 'CONFIRMATION', company: 'Acme', title: 'SWE Intern - Summer 2027', location: '', date: D(2026, 9, 1) };
  assert.strictEqual(fn('matchEvent_')([r], ev, noPick).row, r);
});

test('different location is a new row', () => {
  const r = row({ 'Position': 'SWE Intern', 'Location': 'Texas', 'Gmail Link': 'l' });
  const ev = { type: 'CONFIRMATION', company: 'Acme', title: 'SWE Intern', location: 'California', date: D(2026, 9, 1) };
  assert.strictEqual(fn('matchEvent_')([r], ev, noPick).action, 'create');
});

test('confirmation asks Gemini about hand-typed rows and replaces shorthand', () => {
  const r = row({ 'Position': 'swe intern' });
  const ev = { type: 'CONFIRMATION', company: 'Acme', title: 'Software Engineer Intern', location: 'NYC', date: D(2026, 9, 1), link: 'L' };
  const d = fn('matchEvent_')([r], ev, (e, c) => ({ row: c[0], confident: true }));
  assert.strictEqual(d.row, r);
  const c = fn('changesForEvent_')(r, ev);
  assert.strictEqual(c['Position'], 'Software Engineer Intern');
  assert.strictEqual(c['Location'], 'NYC');
  assert.strictEqual(c['Gmail Link'], 'L');
  assert.strictEqual(c['Date Applied'].getTime(), D(2026, 9, 1).getTime());
  assert.strictEqual(c['Status'], undefined);
});

test('unsure pick goes to review', () => {
  const rows = [row({ 'Position': 'swe intern' }), row({ 'Position': 'platform intern', 'ID': 'y' })];
  const ev = { type: 'CONFIRMATION', company: 'Acme', title: 'Engineering Intern', location: '', date: D(2026, 9, 1) };
  const d = fn('matchEvent_')(rows, ev, () => ({ row: null, confident: false }));
  assert.strictEqual(d.action, 'review');
  assert.strictEqual(d.candidates.length, 2);
});

test('rejection with no title and one open row updates it', () => {
  const r = row({ 'Position': 'SWE Intern', 'Gmail Link': 'l' });
  const ev = { type: 'REJECTION', company: 'Acme', title: '', location: '', date: D(2026, 10, 1) };
  const d = fn('matchEvent_')([r], ev, noPick);
  assert.strictEqual(d.row, r);
  assert.strictEqual(fn('changesForEvent_')(r, ev)['Status'], 'Rejected');
});

test('rejection with no title and several open rows goes to review', () => {
  const rows = [row({ 'Position': 'A' }), row({ 'Position': 'B', 'ID': 'y' })];
  const ev = { type: 'REJECTION', company: 'Acme', title: '', location: '', date: D(2026, 10, 1) };
  assert.strictEqual(fn('matchEvent_')(rows, ev, noPick).action, 'review');
});

test('rejection after July 1 still finds last cycle\'s row', () => {
  const r = row({ 'Cycle': 'Summer 2026', 'Position': 'SWE Intern', 'Gmail Link': 'l' });
  const ev = { type: 'REJECTION', company: 'Acme', title: 'SWE Intern', location: '', date: D(2026, 7, 10) };
  assert.strictEqual(fn('matchEvent_')([r], ev, noPick).row, r);
});

test('rejection for unknown company creates a row with no date applied', () => {
  const ev = { type: 'REJECTION', company: 'Nova', title: 'Intern', location: '', date: D(2026, 10, 1), link: 'L' };
  assert.strictEqual(fn('matchEvent_')([], ev, noPick).action, 'create');
  const r = fn('newRowForEvent_')(ev, 'id1');
  assert.strictEqual(r['Status'], 'Rejected');
  assert.strictEqual(r['Date Applied'], '');
  assert.strictEqual(r['Cycle'], 'Summer 2027');
});

test('status only moves forward and leaves your own values alone', () => {
  const ch = fn('changesForEvent_');
  const ev = (type) => ({ type, company: 'Acme', title: '', location: '', date: D(2026, 10, 1) });
  assert.strictEqual(ch(row({ 'Status': 'Rejected', 'Gmail Link': 'l' }), ev('OA_INVITE'))['Status'], undefined);
  assert.strictEqual(ch(row({ 'Status': 'Ghosted', 'Gmail Link': 'l' }), ev('REJECTION'))['Status'], 'Rejected');
  assert.strictEqual(ch(row({ 'Status': 'Withdrawn', 'Gmail Link': 'l' }), ev('REJECTION'))['Status'], undefined);
  const oa = ch(row({ 'Gmail Link': 'l' }), ev('OA_INVITE'));
  assert.strictEqual(oa['OA'], 'Invited');
  assert.strictEqual(oa['Status'], 'In Progress');
});

test('linked row keeps its title; new wording goes to Other Titles', () => {
  const r = row({ 'Position': 'SWE Intern', 'Gmail Link': 'l' });
  const c = fn('changesForEvent_')(r, { type: 'REJECTION', company: 'Acme', title: 'SWE Intern (Req 9)', location: '', date: D(2026, 10, 1) });
  assert.strictEqual(c['Position'], undefined);
  assert.strictEqual(c['Other Titles'], 'SWE Intern (Req 9)');
});

test('ghosted after 60 days of silence', () => {
  const g = fn('shouldGhost_');
  const now = D(2026, 10, 29);
  assert.strictEqual(g(row({ 'Date Applied': D(2026, 8, 1) }), now), true);
  assert.strictEqual(g(row({ 'Date Applied': D(2026, 8, 1), 'Last Updated': D(2026, 10, 1) }), now), false);
  assert.strictEqual(g(row({ 'Date Applied': D(2026, 8, 1), 'Status': 'In Progress' }), now), false);
  assert.strictEqual(g(row({}), now), false);
});

test('review labels round-trip to row IDs', () => {
  const label = fn('rowLabel_')(row({ 'Position': 'SWE', 'ID': 'ab12cd34', 'Date Applied': D(2026, 9, 1) }));
  assert.strictEqual(fn('idFromLabel_')(label), 'ab12cd34');
  assert.strictEqual(fn('idFromLabel_')('New row'), '');
});
