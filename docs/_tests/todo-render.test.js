/* todo.html 의 두 컬럼 빌더를 그 파일에서 그대로 떼어 여러 상태로 돌린다.
   실행: node docs/_tests/todo-render.test.js

   왜 있나 — render() 는 맨 처음에 list.innerHTML="" 를 한다. 그러니 그 뒤에서
   예외가 하나만 나도 화면이 "일부만 이상"이 아니라 **통째로 빈다.**
   2026-09-01 에 실제로 그랬다: buildImportantNormalColumn 이 buildColumn 의
   지역변수 hidSub 를 읽어서, 오른쪽 상단 패널이 빌 때마다 ReferenceError. */
const fs=require('fs');
const path=require('path');
const NL=String.fromCharCode(10);
const SITE=path.join(__dirname,'..','..');
const page=fs.readFileSync(path.join(SITE,'todo.html'),'utf8');

function grab(name){
  const i=page.indexOf('  function '+name+'(');
  if(i<0) throw new Error(name+' 를 todo.html 에서 못 찾았다');
  const j=page.indexOf(NL+'  function ', i+10);
  return page.slice(i, j);
}
const src=grab('buildColumn')+NL+grab('buildImportantNormalColumn');

/* ── DOM·이웃 함수 스텁 ── */
function el(){ return {className:'',innerHTML:'',textContent:'',children:[],
  appendChild(c){ this.children.push(c); return c; }}; }
const document={createElement:el};
const PR=[["urgent","긴급"],["important","중요"],["normal","일반"],["meeting","미팅"]];
const LANES=[["project","프로젝트","<path/>"],["personal","개인 · 일정","<rect/>"]];
const row=()=>el();
const makeDropZone=()=>{};

const names=['document','PR','row','makeDropZone','state','dragId'];
const vals=n=>({document,PR,row,makeDropZone}[n]);
function build(state,dragId){
  const f=new Function(...names, src+NL+'return {buildColumn:buildColumn,buildImportantNormalColumn:buildImportantNormalColumn};');
  return f(document,PR,row,makeDropZone,state,dragId||null);
}

/* ── 상태 만들기 ── */
let n=0;
const item=(o)=>Object.assign({id:'i'+(++n),text:'x',thtml:'x',detail:'',dhtml:true,
  done:false,hidden:false,lane:'project',priority:'urgent'},o);
const S=(items,extra)=>Object.assign({items:items,hideDone:false,showHidden:false,split:60,collapsed:{}},extra||{});

const 정상=[item({priority:'urgent'}),item({priority:'important'}),item({priority:'normal'}),
           item({priority:'meeting'}),item({lane:'personal',priority:'urgent'})];
const 중요일반숨김=[item({priority:'urgent'}),item({priority:'important',hidden:true}),item({priority:'normal',hidden:true})];
const 중요일반완료=[item({priority:'urgent'}),item({priority:'important',done:true}),item({priority:'normal',done:true})];

const 경우=[
  ['빈 목록',                    S([])],
  ['정상',                       S(정상)],
  ['중요·일반 전부 숨김  ← 오늘 터진 것', S(중요일반숨김)],
  ['중요·일반 전부 숨김 + 숨김보기', S(중요일반숨김,{showHidden:true})],
  ['중요·일반 전부 완료',        S(중요일반완료)],
  ['중요·일반 전부 완료 + 완료숨김', S(중요일반완료,{hideDone:true})],
  ['전부 숨김',                  S(정상.map(i=>Object.assign({},i,{hidden:true})))],
  ['전부 완료',                  S(정상.map(i=>Object.assign({},i,{done:true})))],
  ['개인 레인만 있음',           S([item({lane:'personal',priority:'normal'})])],
  ['끌고 있는 중(dragId)',       S(중요일반숨김), 'i2']
];

let fails=0;
console.log('상태별로 세 판(프로젝트 / 중요·일반 / 개인)을 다 그려 본다.'+NL);
경우.forEach(function(c){
  const [label,state,dragId]=c;
  try{
    const b=build(state,dragId);
    b.buildColumn(LANES[0]);
    b.buildImportantNormalColumn();
    b.buildColumn(LANES[1]);
    console.log('  PASS  '+label);
  }catch(e){
    fails++;
    console.log('  FAIL  '+label+'  →  '+e.name+': '+e.message);
  }
});

/* 빈 안내 문구가 상황에 맞나 (숨겨 놓고 "항목이 없어요" 라고 하면 지웠나 싶다) */
function 빈문구(state){
  try{
    const b=build(state);
    const col=b.buildImportantNormalColumn();
    const e=col.children.filter(c=>c.className==='col-empty')[0];
    return e?e.textContent:'(빈 안내 없음)';
  }catch(err){ return '터짐: '+err.message; }   // 보고서가 여기서 끊기지 않게
}
console.log(NL+'오른쪽 상단 패널의 빈 안내:');
[['중요·일반이 아예 없음', S([item({priority:'urgent'})]), '항목이 없어요.'],
 ['있는데 숨겨 둠',        S(중요일반숨김),                 '표시할 항목이 없어요.'],
 ['있는데 다 완료',        S(중요일반완료),                 '표시할 항목이 없어요.']
].forEach(function(c){
  const got=빈문구(c[1]); const ok=got===c[2]; if(!ok) fails++;
  console.log((ok?'  PASS  ':'  FAIL  ')+c[0]+' = "'+got+'"'+(ok?'':'   (기대: "'+c[2]+'")'));
});

console.log(NL+(fails?('실패 '+fails+'개'):'전부 통과'));
process.exit(fails?1:0);
