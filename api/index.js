'use strict';
// The only serverless function in this project. See api/_lib/router.js.
// Plain filename on purpose (no [brackets]): vercel.json rewrites /api/* here and the router reads the ORIGINAL url.
const { dispatch } = require('./_lib/router');

module.exports = (req, res) => dispatch(req, res);
