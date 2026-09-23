#!/usr/bin/env node
/* ------------------------------------------------------------------
   dist/ 를 만든다. 의존성 0 — Vercel 시절 그대로 "정적 파일 + 함수" 구조를
   유지하려고 빌드 도구를 넣지 않았다. 이 파일이 그 원칙을 지키는 유일한 단계다.

   ★ 화이트리스트로 복사한다(전체 폴더를 그대로 밀지 않는다).
     지금 운영 중인 Vercel 은 *.ps1 스크립트가 그대로 공개돼 있다
     (`/rcw/publish-help.ps1` 200 실측, 2026-09-23). 여기서 고른 파일만 나가므로
     저절로 막힌다.

   ★ 페이지는 dist/rcw/ 에 "진짜로" 놓는다. 예전엔 파일이 루트에 있고
     /rcw/* 를 rewrite 로 흉내 냈다(vercel.json). 그 방식은 상대경로 링크가
     기준 삼는 디렉터리와 실제 파일 위치가 달라 자꾸 새는 자리였다.
     실제로 옮겨 놓으면 상대경로가 그냥 맞는다.

   ★ img·releases.json 은 두 자리에 낸다(루트 + /rcw/) — 페이지마다 절대경로
     기준이 다르다(whatsnew.html 은 "/img/...", 나머지는 "img/..." 상대경로;
     admin.html 은 "releases.json" 상대경로, 플러그인은 루트 "/releases.json"
     을 직접 본다). 실측: grep 으로 둘 다 쓰는 페이지가 있었다.
------------------------------------------------------------------ */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');

// dist/rcw/ 에 그대로 옮길 루트 페이지들. 새 페이지를 추가하면 여기 한 줄만 늘리면
// 되고, _redirects 의 clean-URL 규칙도 이 목록에서 자동으로 만들어진다(아래).
const ROOT_PAGES = [
  'admin.html', 'cad.html', 'contact.html', 'customer.html',
  'guide-en.html', 'guide-ko.html', 'index.html', 'modeling.html',
  'output.html', 'todo.html', 'trial.html',
  'whatsnew-5.3.1.html', 'whatsnew.html'
];
const ROOT_ASSETS = ['changes.js'];

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function copyFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function copyDir(from, to) {
  let entries;
  try {
    entries = await fs.readdir(from, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  await fs.mkdir(to, { recursive: true });
  let count = 0;
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      count += await copyDir(src, dst);
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst);
      count += 1;
    }
  }
  return count;
}

function headersFile() {
  return [
    '/img/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/rcw/img/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/rcw/help/img/*',
    '  Cache-Control: public, max-age=604800',
    '',
    '/releases.json',
    '  Cache-Control: public, max-age=60, must-revalidate',
    '',
    '/rcw/releases.json',
    '  Cache-Control: public, max-age=60, must-revalidate',
    ''
  ].join('\n');
}

function redirectsFile(pageNames) {
  // ★ CF Pages 는 *.html 정적 파일을 "확장자 없이도" 자동으로 서비스하고,
  //   .html 로 직접 부르면 확장자 없는 쪽으로 308 을 스스로 보낸다(플랫폼 기본 동작,
  //   끌 수 없다 — 실측 2026-09-23). 그 위에 "확장자를 붙여주는" 내 rewrite 를 얹었더니
  //   /rcw/admin ↔ /rcw/admin.html 이 서로를 308 로 돌려보내는 무한루프가 났다.
  //   그래서 clean-URL 규칙은 만들지 않는다 — 플랫폼이 이미 한다.
  const lines = [];
  lines.push('# 이 파일은 build.mjs 가 만든다 — 손으로 고치면 다음 빌드에서 사라진다.');
  lines.push('');
  lines.push('# 도메인 루트 → /rcw (트레일링 슬래시까지 한 번에, 중간 홉 없음)');
  lines.push('/         /rcw/              302');
  lines.push('');
  lines.push('# 옛 평면 경로(북마크·이메일에 남아 있을 수 있는 링크) → /rcw 아래로');
  lines.push('/help/*   /rcw/help/:splat  301');
  for (const name of pageNames) {
    const bare = name.replace(/\.html$/, '');
    if (bare === 'index') continue; // '/' 가 이미 /rcw/ 로 보낸다 — '/index' 는 실제로 안 쓰인다
    lines.push(`/${bare}   /rcw/${bare}   301`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  console.log('[build] dist/ 새로 만드는 중...');
  await rmrf(DIST);
  await fs.mkdir(DIST, { recursive: true });
  await fs.mkdir(path.join(DIST, 'rcw'), { recursive: true });

  let n = 0;

  // 루트 페이지 → dist/rcw/
  for (const name of ROOT_PAGES) {
    await copyFile(path.join(ROOT, name), path.join(DIST, 'rcw', name));
    n += 1;
  }
  for (const name of ROOT_ASSETS) {
    await copyFile(path.join(ROOT, name), path.join(DIST, 'rcw', name));
    n += 1;
  }
  console.log(`[build] 루트 페이지 ${ROOT_PAGES.length + ROOT_ASSETS.length}개 → dist/rcw/`);

  // help/ → dist/rcw/help/ (내부 링크가 전부 상대경로라 이 한 자리면 된다)
  const helpCount = await copyDir(path.join(ROOT, 'help'), path.join(DIST, 'rcw', 'help'));
  console.log(`[build] help/ ${helpCount}개 파일 → dist/rcw/help/`);
  if (helpCount === 0) throw new Error('help/ 가 비었다 — 복사 대상이 없다. 경로를 확인할 것.');

  // img/ → dist/img/ 와 dist/rcw/img/ 둘 다 (페이지마다 절대·상대가 갈린다)
  const imgCountRoot = await copyDir(path.join(ROOT, 'img'), path.join(DIST, 'img'));
  const imgCountRcw = await copyDir(path.join(ROOT, 'img'), path.join(DIST, 'rcw', 'img'));
  console.log(`[build] img/ ${imgCountRoot}개 파일 → dist/img/ 와 dist/rcw/img/`);
  if (imgCountRoot === 0) throw new Error('img/ 가 비었다.');
  if (imgCountRoot !== imgCountRcw) throw new Error('img/ 두 사본의 개수가 다르다 — 복사 도중 문제.');

  // releases.json → 루트 + /rcw/ 둘 다 (admin.html 이 상대경로로 읽는다)
  await copyFile(path.join(ROOT, 'releases.json'), path.join(DIST, 'releases.json'));
  await copyFile(path.join(ROOT, 'releases.json'), path.join(DIST, 'rcw', 'releases.json'));
  console.log('[build] releases.json → dist/ 와 dist/rcw/ 둘 다');

  // robots.txt → 루트만
  await copyFile(path.join(ROOT, 'robots.txt'), path.join(DIST, 'robots.txt'));

  // _headers, _redirects — CF Pages 가 dist/ 안의 이 두 파일을 읽는다
  await fs.writeFile(path.join(DIST, '_headers'), headersFile(), 'utf8');
  await fs.writeFile(path.join(DIST, '_redirects'), redirectsFile(ROOT_PAGES), 'utf8');
  console.log('[build] _headers · _redirects 생성');

  n += helpCount + imgCountRoot + imgCountRcw + 3; // releases.json×2 + robots.txt
  console.log(`[build] 완료 — 파일 ${n}개 이상 기록.`);
}

main().catch((err) => {
  console.error('[build] 실패:', err);
  process.exit(1);
});
