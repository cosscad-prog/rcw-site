/* todo.html 의 history 절(기록 보기 · 되돌리기)을 그 파일에서 그대로 떼어 돌린다.
   실행: node docs/_tests/todo-history.test.js

     1단계  todo_state    지금 목록                    (todo-sync.test.js 가 본다)
     2단계  todo_day      하루에 한 줄, 30일치
     3단계  todo_archive  30일 지난 것을 한 줄에

   ⚠️ 2·3단계를 **만드는** 일은 2026-09-01 부터 브라우저가 하지 않는다 — DB 트리거가 한다
      (docs/supabase-todo.sql). 그래서 여기서 볼 수 있는 것은 **읽고 되돌리는 쪽**뿐이다.
      트리거 자체는 이 검사가 못 본다. 확인은 그 SQL 파일 끝의 자체시험(rollback)으로 한다. */
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
    children: [],
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, addEventListener() {}, click() {} };
}
const els = {};
['hxStatus', 'hxOpen', 'hxExport', 'hxCloseBtn', 'hxOverlay', 'hxList'].forEach(i => { els[i] = El(); });
const document = { getElementById: i => els[i] || El(), createElement: El, addEventListener() {}, body: El(), documentElement: { outerHTML: '<head></head>' } };
let confirmAnswer = true;
const window = { confirm: () => confirmAnswer, addEventListener() {} };
let alerted = '';
const alert = m => { alerted = m; };
const URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
const Blob = function () {};
const esc = s => String(s);
const KEY = 'todo_app_v1';

/* 서버 — todo_day 와 todo_archive 를 읽기 위주로 흉내낸다 */
let dayRows = [];
let archive = null;
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
    if (method === 'GET') { const r = dayRows.slice(); r.sort((a, b) => (a.day < b.day ? 1 : -1)); return res(r, 200); }
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
  src + NL + 'return {hxLoadDays,hxOpen,hxClose,hxRestore,hxDayOf,hxInit,hxRenderStatus,hxExport,HX_KEEP};');
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

  P('0) 브라우저는 하루치를 만들지 않는다 — DB 트리거가 한다');
  chk('todo_day 로 쓰는 코드가 없다', /todo_day[\s\S]{0,120}method:"POST"/.test(src), false);
  chk('POST 하는 곳은 보관(되돌리기 직전) 한 군데뿐', (src.match(/method:"POST"/g) || []).length, 1);

  P('1) 기록 목록 — 하루치와 보관을 한 줄로 세운다');
  dayRows = [
    { day: '2026-08-30', data: { items: [item('그저께')] } },
    { day: '2026-08-31', data: { items: [item('어제1'), item('어제2')] } }
  ];
  archive = { days: [
    { day: '2026-07-01', data: { items: [item('7월')] } },
    { day: '2026-08-01 14:20', label: '되돌리기 직전', data: { items: [] } }
  ] };
  const rows = await hx.hxLoadDays();
  chk('줄 수 = 하루치 2 + 보관 2', rows.length, 4);
  chk('맨 위는 가장 최근', rows[0].day, '2026-08-31');
  chk('하루치 표시', rows[0].where, '최근');
  chk('보관은 최신순으로 뒤에', rows[2].day, '2026-08-01 14:20');
  chk('이름표가 있으면 그것을 쓴다', rows[2].label, '되돌리기 직전');
  chk('보관 표시', rows[3].where, '보관');

  P('2) 화면에 뿌리기');
  hx = build();
  hx.hxOpen();
  await sleep(20);
  chk('창이 열림', els.hxOverlay.classList.contains('hide'), false);
  chk('줄이 그려짐', els.hxList.children.length, 4);
  chk('첫 줄에 날짜', els.hxList.children[0].innerHTML.indexOf('2026-08-31') >= 0, true);
  chk('개수 표시', els.hxList.children[0].innerHTML.indexOf('2개 · 미완료 2') >= 0, true);
  hx.hxClose();
  chk('닫힘', els.hxOverlay.classList.contains('hide'), true);

  P('3) 기록이 없을 때');
  hx = build();
  dayRows = []; archive = null;
  hx.hxOpen();
  await sleep(20);
  chk('안내 문구', els.hxList.innerHTML.indexOf('아직 기록이 없습니다') >= 0, true);

  P('4) 되돌리기 — 직전 상태를 먼저 남기고 나서 바꾼다');
  hx = build();
  dayRows = [{ day: '2026-08-31', data: { items: [item('어제 것')] } }];
  archive = null;
  state.items = [item('지금1'), item('지금2'), item('지금3')];
  applied = null; pushed = 0; calls = [];
  const list = await hx.hxLoadDays();
  hx.hxRestore(list[0]);
  await sleep(30);
  chk('화면에 그날 것이 적용됨', applied.items[0].text, '어제 것');
  chk('1단계로 올림', pushed > 0, true);
  chk('직전 상태가 보관에 남음', archive.days.length, 1);
  chk('그 이름표', archive.days[0].label, '되돌리기 직전');
  chk('거기 담긴 항목 수', archive.days[0].data.items.length, 3);
  chk('★ 보관에 쓰고 나서 화면을 바꿈', calls.indexOf('POST todo_archive') >= 0, true);

  P('5) 아니오를 누르면 아무 일도 안 한다');
  hx = build();
  archive = null; applied = null; pushed = 0; calls = [];
  confirmAnswer = false;
  hx.hxRestore({ day: '2026-08-31', data: { items: [] } });
  await sleep(30);
  confirmAnswer = true;
  chk('화면 안 바뀜', applied, null);
  chk('보관에 안 씀', archive, null);
  chk('서버를 안 두드림', calls.length, 0);

  P('6) 직전 상태를 못 남기면 되돌리지 않는다');
  hx = build();
  archive = null; applied = null; pushed = 0; alerted = '';
  failArchiveWrite = true;
  hx.hxRestore({ day: '2026-08-31', data: { items: [item('어제 것')] } });
  await sleep(30);
  failArchiveWrite = false;
  chk('화면을 안 바꿈', applied, null);
  chk('1단계로 안 올림', pushed, 0);
  chk('알려 줌', alerted.indexOf('아무것도 바뀌지 않았습니다') >= 0, true);

  P('7) 하단 표시');
  hx = build();
  dayRows = [{ day: '2026-08-30', data: {} }, { day: '2026-08-31', data: {} }];
  archive = { days: [{ day: '2026-07-01', data: {} }] };
  hx.hxRenderStatus();
  await sleep(30);
  chk('문구', els.hxStatus.textContent, '기록 2일치 · 보관 1일');

  P('');
  P(fails ? ('실패 ' + fails + '개') : ('전부 통과 — 검사 ' + out.filter(l => l.indexOf('  PASS') === 0).length + '개'));
  P('⚠️ 2·3단계를 만드는 트리거는 이 검사가 못 본다 — docs/supabase-todo.sql 끝의 자체시험으로 확인할 것.');
  console.log(out.join(NL));
  process.exit(fails ? 1 : 0);
})();
