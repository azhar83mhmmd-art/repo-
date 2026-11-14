'use strict';
// The only serverless function in this project. See api/_lib/router.js.
// Catch-all file: every /api/* request lands here with its ORIGINAL url, and the router reads the query from that url
// (no vercel.json rewrite, so a real ?path=... can never be overwritten).
const { dispatch } = require('./_lib/router');

module.exports = (req, res) => dispatch(req, res);
