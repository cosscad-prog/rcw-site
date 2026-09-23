// Vercel 함수(../../api/customer-profile.js)를 CF Pages Functions 로 여는 창구.
// 본문은 한 곳(lib/vercel-shim.js)에서 관리 — 이 파일은 손대지 않는다.
// ★ ESM export 여야 한다 — CommonJS(module.exports.onRequest)로 썼더니 CF 의
//   Functions 라우터가 "No routes found" 로 통째로 못 찾았다(2026-09-23 실측).
import { wrap } from '../../lib/vercel-shim.js';
import handler from '../../api/customer-profile.js';

export const onRequest = wrap(handler);
