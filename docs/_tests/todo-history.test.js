/* todo.html 의 3단계 저장(history 절)을 그 파일에서 그대로 떼어 돌린다.
   실행: node docs/_tests/todo-history.test.js

     1단계  todo_state    지금 목록          (todo-sync.test.js 가 본다)
     2단계  todo_day      하루에 한 줄, 30일치
     3단계  todo_archive  30일 지난 것을 한 줄에

   여기서 제일 중요한 것은 hxFold 의 **순서**다. 보관에 넣기 전에 지우면 그 날은 없어진다. */
const fs = require('fs');
const path = require('path');
const NL = String.fromCharCode(10);
const SITE = path.join(__dirname, '..', '..');
const page = fs.readFileSync(path.join(SITE, 'todo.html'), 'utf8');

const i0 = page.indexOf('  /* ---- history ');
if (i0 < 0) { console.error('todo.html 에서 history 절을 못 찾았다'); process.exit(1); }
const src = page.slice(i0, page.indexOf(NL + '  /* ---- date ---- */'));
if (src.length < 1000) { console.error('history 절을 제대로 못 떼어 왔다 (' + src.length + '자)'); process.exit(1); }
process.on('unhandledRejection', e => { console.log('  ↑ 삼켜진 예외: ' + ((e && e.stack) || e)); });

/* ── 스텁 ───────────────────────────────────────────────── */
const UID = '11111111-1111-1111-1111-111111111111';
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
function El() {
  return { textContent: '', className: '', title: '', innerHTML: '', href: '', download: '', onclick: null,
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    appendChild() {}, removeChild() {}, addEventListener() {}, click() {} };
}
const els = {};
['hxStatus', 'hxOpen', 'hxExport', 'hxCloseBtn', 'hxOverlay', 'hxList'].forEach(i => { els[i] = El(); });
const document = { getElementById: i => els[i] || El(), createElement: El, addEventListener() {}, body: El(), documentElement: { outerHTML: '<head></head>' } };
const window = { confirm: () => true, addEventListener() {} };
const alert = () => {};
const URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
const Blob = function () {};
const esc = s => String(s);
const KEY = 'todo_app_v1';

/* 서버 — 세 표를 흉내낸다. 어떤 순서로 두드렸는지 기록한다. */
let dayRows = [];            // [{day,data}]
let archive = null;          // {days:[...]}
let calls = [];
let failArchiveWrite = false;
function res(body, status) {
  if (status >= 400) { const e = new Error(status + ' ' + JSON.stringify(body)); e.status = status; return Promise.reject(e); }
  return Promise.resolve(body);       // ★ 페이지의 sbFetch 는 이미 JSON 을 풀어서 준다
}
function sbFetch(pathq, opts) {
  opts = opts || {};
  const method = opts.method || 'GET';
  const table = pathq.split('/rest/v1/')[1].split('?')[0];
  calls.push(method + ' ' + table);
  if (table === 'todo_day') {
    if (method === 'GET') {
      const lt = (pathq.split('day=lt.')[1] || '').split('&')[0];
      const rows = lt ? dayRows.filter(r => r.day < lt) : dayRows.slice();
      rows.sort((a, b) => (a.day < b.day ? -1 : 1));
      return res(rows, 200);
    }
    if (method === 'DELETE') {
      const lt = (pathq.split('day=lt.')[1] || '').split('&')[0];
      dayRows = dayRows.filter(r => !(r.day < lt));
      return res(null, 204);
    }
    const b = JSON.parse(opts.body);
    dayRows = dayRows.filter(r => r.day !== b.day).concat([{ day: b.day, data: b.data }]);
    return res(null, 204);
  }
  if (table === 'todo_archive') {
    if (method === 'GET') return res(archive ? [{ data: archive }] : [], 200);
    if (failArchiveWrite) return res({ message: 'boom' }, 500);
    archive = JSON.parse(opts.body).data;
    return res(null, 204);
  }
  return res(null, 204);
}

/* 동기화 절에서 넘어오는 것들 */
let sbRefresh = 'R1', sbUser = { id: UID };
const sbAuthed = () => Promise.resolve();
let applied = null;
const sbApplyRemote = d => { applied = d; };
let pushed = 0;
const sbPush = () => { pushed++; };
let state = { items: [], hideDone: false, split: 60, collapsed: {} };
const snapshot = () => ({ items: state.items, hideDone: state.hideDone, split: state.split, collapsed: state.collapsed });

const names = ['localStorage', 'document', 'window', 'alert', 'URL', 'Blob', 'esc', 'KEY',
  'sbFetch', 'sbRefresh', 'sbUser', 'sbAuthed', 'sbApplyRemote', 'sbPush', 'snapshot',
  'setTimeout', 'clearTimeout', 'Date', 'JSON', 'Promise', 'encodeURIComponent', 'console'];
const vals = { localStorage, document, window, alert, URL, Blob, esc, KEY, sbFetch, sbRefresh, sbUser,
  sbAuthed, sbApplyRemote, sbPush, snapshot, setTimeout, clearTimeout, Date, JSON, Promise, encodeURIComponent, console };
const factory = new Function(...names,
  src + NL + 'return {hxTouchDay,hxFold,hxLoadDays,hxRestore,hxToday,hxDaysAgo,hxDayOf,hxInit,hxRenderStatus,hxExport,HX_KEEP};');
const build = () => factory(...names.map(n => vals[n]));

/* ── 검사 ───────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
let fails = 0;
const P = s => out.push(s);
function chk(label, got, want) {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  out.push((ok ? '  PASS ' : '  FAIL ') + label + ' = ' + got + (ok ? '' : '   (기대: ' + want + ')'));
}
const item = (t, o) => Object.assign({ id: t, text: t, thtml: t, detail: '', dhtml: true, done: false, hidden: false, lane: 'project', priority: 'urgent' }, o || {});

(async () => {
  let hx = build();

  // 1) 2단계 — 오늘 줄
  P('1) 하루치 기록 (2단계)');
  state.items = [item('a'), item('b')];
  hx.hxTouchDay();
  await sleep(30);
  chk('오늘 줄이 생김', dayRows.length, 1);
  chk('오늘 날짜', dayRows[0].day, hx.hxToday());
  chk('그 줄에 담긴 항목 수', dayRows[0].data.items.length, 2);

  P('2) 연달아 고쳐도 서버를 계속 두드리지 않는다');
  const before = calls.filter(c => c === 'POST todo_day').length;
  state.items.push(item('c'));
  hx.hxTouchDay(); hx.hxTouchDay(); hx.hxTouchDay();
  await sleep(30);
  chk('추가 쓰기 없음(1분 안)', calls.filter(c => c === 'POST todo_day').length - before, 0);
  chk('그래도 잊지 않는다(예약됨)', dayRows[0].data.items.length, 2);   // 아직 옛 내용

  // 3) 3단계 — 30일 지난 것 몰기
  P('3) 30일 지난 하루치를 보관으로 (3단계)');
  hx = build();                      // 새 화면을 연 셈
  delete store.todo_hx_folded;
  dayRows = [
    { day: hx.hxDaysAgo(60), data: { items: [item('아주 옛날')] } },
    { day: hx.hxDaysAgo(40), data: { items: [item('옛날')] } },
    { day: hx.hxDaysAgo(3),  data: { items: [item('최근')] } }
  ];
  archive = null; calls = [];
  const moved = await hx.hxFold();
  chk('옮긴 날 수', moved, 2);
  chk('2단계에 남은 날 수', dayRows.length, 1);
  chk('남은 것은 최근 것', dayRows[0].day, hx.hxDaysAgo(3));
  chk('보관에 들어간 날 수', archive.days.length, 2);
  chk('보관은 날짜 오름차순', archive.days[0].day < archive.days[1].day, true);
  const iPut = calls.indexOf('POST todo_archive'), iDel = calls.indexOf('DELETE todo_day');
  chk('★ 넣기가 지우기보다 먼저다', iPut >= 0 && iPut < iDel, true);

  P('4) 같은 날 다시 열어도 또 하지 않는다');
  calls = [];
  chk('두 번째 정리는 0건', await hx.hxFold(), 0);
  chk('서버를 두드리지 않음', calls.length, 0);

  P('5) 보관 쓰기가 실패하면 — 하루치를 지우지 않는다');
  hx = build(); delete store.todo_hx_folded;
  dayRows = [{ day: hx.hxDaysAgo(50), data: { items: [item('지키자')] } }];
  archive = null; calls = []; failArchiveWrite = true;
  await hx.hxFold();
  failArchiveWrite = false;
  chk('하루치가 그대로 남음', dayRows.length, 1);
  chk('지우기를 부르지 않음', calls.indexOf('DELETE todo_day'), -1);
  P('   → 다음에 다시 시도한다');
  hx = build(); delete store.todo_hx_folded;
  chk('재시도로 옮겨짐', await hx.hxFold(), 1);
  chk('이제 하루치는 빔', dayRows.length, 0);

  P('6) 같은 날짜가 보관에 두 번 들어가지 않는다');
  hx = build(); delete store.todo_hx_folded;
  const d = hx.hxDaysAgo(45);
  dayRows = [{ day: d, data: { items: [item('한 번')] } }];
  await hx.hxFold();
  const n1 = archive.days.length;
  hx = build(); delete store.todo_hx_folded;
  dayRows = [{ day: d, data: { items: [item('또')] } }];   // 지우기가 끊겼다고 치자
  await hx.hxFold();
  chk('보관 날 수가 안 늘어남', archive.days.length, n1);

  // 7) 되돌리기
  P('7) 되돌리기');
  hx = build();
  archive = { days: [{ day: '2026-08-01', data: { items: [item('그날 것')] } }] };
  dayRows = [];
  state.items = [item('지금 것1'), item('지금 것2'), item('지금 것3')];
  applied = null; pushed = 0;
  const rows = await hx.hxLoadDays();
  chk('목록에 보관분이 보임', rows.length, 1);
  await hx.hxRestore(rows[0]);
  await sleep(30);
  chk('화면에 그날 것이 적용됨', applied.items[0].text, '그날 것');
  chk('1단계로 올림', pushed > 0, true);
  chk('되돌리기 직전 상태가 보관에 남음', archive.days.length, 2);
  const keep = archive.days[archive.days.length - 1];
  chk('그 이름표', keep.label, '되돌리기 직전');
  chk('거기 담긴 항목 수', keep.data.items.length, 3);

  P('');
  P(fails ? ('실패 ' + fails + '개') : ('전부 통과 — 검사 ' + out.filter(l => l.indexOf('  PASS') === 0).length + '개'));
  console.log(out.join(NL));
  process.exit(fails ? 1 : 0);
})();
