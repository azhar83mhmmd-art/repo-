'use strict';
// The only serverless function in this project. See api/_lib/router.js.
const { dispatch } = require('./_lib/router');

module.exports = (req, res) => dispatch(req, res);
