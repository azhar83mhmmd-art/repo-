'use strict';
// The only serverless function in this project. See api/_lib/router.js.
// NOTE: the catch-all is deliberately NOT named [...path] — endpoints use a ?path= query parameter.
const { dispatch } = require('./_lib/router');

module.exports = (req, res) => dispatch(req, res);
