/* todo.html 의 Supabase 동기화 블록을 그 파일에서 그대로 떼어 내
   fetch·DOM 만 가짜로 두고 검증한다.  실행: node docs/_tests/todo-sync.test.js
   ★ 사본을 검사하지 않는다 — 배포되는 todo.html 을 읽어 그 안의 코드를 돌린다. */
const fs=require('fs');
const path=require('path');
const SITE=path.join(__dirname,'..','..');
const page=fs.readFileSync(path.join(SITE,'todo.html'),'utf8');
const src=page.slice(page.indexOf('  /* ---- Supabase '), page.indexOf('  /* ---- backup ----'));
if(!src) { console.error('todo.html 에서 동기화 블록을 못 찾았다'); process.exit(1); }

// ---- 스텁 ----
const store={};
const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}};
function El(){ return {textContent:'',className:'',value:'',disabled:false,style:{},onclick:null,
  classList:{s:new Set(),add(c){this.s.add(c)},remove(c){this.s.delete(c)},contains(c){return this.s.has(c)}},
  addEventListener(){},focus(){}}; }
const els={}; ['syncBadge','loginOverlay','syncLogout','loginBtn','loginPw','loginEmail','loginErr'].forEach(i=>els[i]=El());
const docListeners={};
const document={getElementById:i=>els[i],addEventListener:(e,f)=>{docListeners[e]=f},visibilityState:'visible'};
const window={addEventListener(){}};
// 페이지 쪽 의존물
const KEY='todo_app_v1';
let state={items:[],hideDone:false,split:60,collapsed:{}};
function snapshot(){ return {items:state.items,hideDone:state.hideDone,split:state.split,collapsed:state.collapsed}; }
function normalizeItem(i){ if(!i.lane) i.lane='project'; }
let renders=0; function render(){ renders++; }

// ---- 가짜 Supabase ----
const UID='11111111-1111-1111-1111-111111111111';
let row=null, calls=[], failNext=false, tokenIssued=0;
function res(body,status){ return Promise.resolve({ok:status<400,status,text:()=>Promise.resolve(body===null?'':JSON.stringify(body))}); }
function fetch(url,opts){
  opts=opts||{}; const path=String(url).split('.co')[1]; const m=(opts.method||'GET');
  calls.push(m+' '+path.split('?')[0]+(path.indexOf('grant_type=')>=0?'?'+path.split('grant_type=')[1]:''));
  const auth=opts.headers.Authorization;
  if(path.indexOf('grant_type=password')>=0) return res({access_token:'A1',refresh_token:'R1',expires_in:3600,user:{id:UID,email:'me@x.com'}},200);
  if(path.indexOf('grant_type=refresh_token')>=0){ tokenIssued++; return res({access_token:'A'+(tokenIssued+1),refresh_token:'R'+(tokenIssued+1),expires_in:3600,user:{id:UID,email:'me@x.com'}},200); }
  if(auth!=='Bearer A1'&&auth.indexOf('Bearer A')!==0) return res({message:'no auth'},401);
  if(failNext){ failNext=false; return res({message:'boom'},500); }
  if(m==='GET') return res(row?[row]:[],200);
  const b=JSON.parse(opts.body); row={data:b.data,updated_at:b.updated_at}; return res(null,204);
}
const Promise_=Promise;
const scope={localStorage,document,window,fetch,KEY,snapshot,normalizeItem,render,Object,Date,JSON,setTimeout,clearTimeout,encodeURIComponent,Promise,Error,console};
const names=Object.keys(scope);
const factory=new Function(...names,'state',src+'\n return {sbInit,sbPush,sbPull,sbSetBadge,get pending(){return sbPending},get ready(){return sbReady},get user(){return sbUser},get remoteStamp(){return sbRemoteStamp},setState:function(s){state=s;}};');
const api=factory(...names.map(n=>scope[n]),state);

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out=[]; const P=s=>out.push(s);
let fails=0;
function chk(label,got,want){ const ok=String(got)===String(want); if(!ok) fails++; P((ok?'  PASS ':'  FAIL ')+label+' = '+got+(ok?'':'   (기대: '+want+')')); }

(async()=>{
  // 1) 세션 없음 → 로그인 화면
  api.sbInit();
  P('1) 세션 없이 열었을 때');
  chk('오버레이 보임(hide 없음)', !els.loginOverlay.classList.contains('hide'), true);
  chk('배지', els.syncBadge.textContent, '☁️ 로그인 필요');
  chk('서버 호출 수', calls.length, 0);

  // 2) 로그인
  P('2) 로그인');
  els.loginEmail.value='me@x.com'; els.loginPw.value='pw12345';
  els.loginBtn.onclick();
  await sleep(60);
  chk('오버레이 숨김', els.loginOverlay.classList.contains('hide'), true);
  chk('비밀번호 칸 비움', els.loginPw.value==='', true);
  chk('세션 저장됨(refresh_token)', JSON.parse(store.todo_sb_session).refresh_token, 'R1');
  chk('세션에 비밀번호 안 들어감', JSON.stringify(store.todo_sb_session).indexOf('pw12345')<0, true);
  chk('서버에 줄 없어서 최초 업로드됨', row!==null, true);
  chk('올린 items 수', row.data.items.length, 0);

  // 3) 항목 추가 → 자동 저장 (debounce 800ms)
  P('3) 항목을 추가하고 800ms 기다림');
  state.items.push({id:'a1',text:'첫 항목',done:false,priority:'urgent',lane:'project'});
  api.sbPush(false);
  chk('저장 대기중 표시', api.pending, true);
  await sleep(1000);
  chk('서버 items 수', row.data.items.length, 1);
  chk('대기 해제', api.pending, false);
  chk('배지가 초록', els.syncBadge.className.indexOf('ok')>=0, true);

  // 4) 저장 실패는 초록으로 덮이지 않는다
  P('4) 서버가 500 을 돌려줄 때');
  failNext=true;
  state.items.push({id:'a2',text:'둘째',done:false,priority:'normal',lane:'project'});
  api.sbPush(true);
  await sleep(60);
  chk('배지', els.syncBadge.textContent, '⚠️ 동기화 실패 (눌러 재시도)');
  chk('대기 유지(밀린 저장 안 잊음)', api.pending, true);
  chk('배지 클릭 재시도 붙음', typeof els.syncBadge.onclick, 'function');
  els.syncBadge.onclick();                    // 눌러서 재시도
  await sleep(60);
  chk('재시도 후 서버 items 수', row.data.items.length, 2);
  chk('배지 초록 복귀', els.syncBadge.className.indexOf('ok')>=0, true);

  // 5) 다른 기기 변경 가져오기
  P('5) 다른 기기가 고친 뒤 화면 복귀(visibilitychange)');
  row={data:{items:[{id:'z1',text:'폰에서 넣은 것',done:false,priority:'urgent',lane:'project'}],hideDone:false,split:60,collapsed:{}},updated_at:'2026-09-01T09:00:00.000Z'};
  const r0=renders;
  docListeners.visibilitychange();
  await sleep(60);
  chk('화면 items 수', state.items.length, 1);
  chk('가져온 항목', state.items[0].text, '폰에서 넣은 것');
  chk('다시 그렸나', renders>r0, true);
  chk('로컬 저장소에도 반영', JSON.parse(store[KEY]).items[0].text, '폰에서 넣은 것');

  // 6) 같은 stamp 면 다시 그리지 않는다
  P('6) 서버가 그대로일 때 다시 복귀');
  const r1=renders, c1=calls.length;
  docListeners.visibilitychange();
  await sleep(60);
  chk('서버는 읽되', calls.length>c1, true);
  chk('다시 그리지 않음', renders, r1);

  // 7) 밀린 저장이 있으면 pull 이 덮어쓰지 않는다
  P('7) 안 올라간 내 변경이 있을 때 복귀');
  state.items.push({id:'a3',text:'아직 안 올라간 것',done:false,priority:'urgent',lane:'project'});
  api.sbPush(false);                          // 800ms 대기중 = 아직 안 올라감
  row={data:{items:[],hideDone:false,split:60,collapsed:{}},updated_at:'2026-09-01T10:00:00.000Z'};
  docListeners.visibilitychange();            // pending 이므로 즉시 push 여야 한다
  await sleep(120);
  chk('내 변경이 서버로 올라감', row.data.items.length, 2);
  chk('화면이 빈 목록으로 덮이지 않음', state.items.length, 2);

  // 8) 만료 토큰 자동 갱신
  P('8) 토큰이 만료된 뒤 저장');
  const before=tokenIssued;
  // 만료를 흉내내려면 저장된 세션만 남기고 다시 시작한다
  api.sbSetBadge('reset','');
  store.todo_sb_session=JSON.stringify({refresh_token:'R1',user:{id:UID,email:'me@x.com'}});
  const api2=factory(...names.map(n=>scope[n]),state);
  api2.sbInit();                              // access_token 없음 → refresh 먼저
  await sleep(80);
  chk('refresh 로 새 토큰 받음', tokenIssued>before, true);
  chk('저장된 세션이 새 refresh_token 으로 갱신', JSON.parse(store.todo_sb_session).refresh_token!=='R1', true);
  chk('오버레이 숨김(재로그인 안 시킴)', els.loginOverlay.classList.contains('hide'), true);

  // 9) 로그아웃
  P('9) 로그아웃');
  els.syncLogout.onclick();
  chk('세션 지워짐', store.todo_sb_session===undefined, true);
  chk('오버레이 다시 보임', !els.loginOverlay.classList.contains('hide'), true);

  P('');
  P('호출한 끝점: '+[...new Set(calls)].join(' | '));
  P(fails===0?('전부 통과 — 검사 '+out.filter(l=>l.indexOf('  PASS')===0).length+'개'):('실패 '+fails+'개'));
  console.log(out.join('\n'));
  process.exit(fails?1:0);
})();
