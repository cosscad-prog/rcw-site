// Vercel 함수(../../api/customer-download.js)를 CF Pages Functions 로 여는 창구.
// 본문은 한 곳(lib/vercel-shim.js)에서 관리 — 이 파일은 손대지 않는다.
const { wrap } = require('../../lib/vercel-shim.js');
const handler = require('../../api/customer-download.js');
module.exports.onRequest = wrap(handler);
