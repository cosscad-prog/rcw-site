// 플러그인 하루 1회 체크인 창구 — Cloudflare 전용(본문은 lib/checkin.js).
// api/ 에 두지 않는 이유는 그 파일 머리말 참조(Vercel 뒷문 함수 12개 한도).
import { wrap } from '../../lib/vercel-shim.js';
import handler from '../../lib/checkin.js';

export const onRequest = wrap(handler);
