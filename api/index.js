'use strict';
// The only serverless function in this project. See api/_lib/router.js.
// Plain filename on purpose (no [brackets]): vercel.json rewrites /api/* here. The rewrite param is named
// __rf_route so it can never collide with real params such as ?path=... ; the router also ignores it.
const { dispatch } = require('./_lib/router');

module.exports = (req, res) => dispatch(req, res);
