// 설치기가 고객 코드로 에디션을 묻는 창구 — Cloudflare 전용(본문은 lib/edition-check.js).
// api/ 에 두지 않는 이유는 그 파일 머리말 참조(Vercel 뒷문 함수 12개 한도).
import { wrap } from '../../lib/vercel-shim.js';
import handler from '../../lib/edition-check.js';

export const onRequest = wrap(handler);
