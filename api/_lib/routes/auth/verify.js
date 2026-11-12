'use strict';
// GET /api/auth/verify — re-validates the token held by the browser (stateless).
const { route } = require('../../http');
const { summarizeAuth } = require('../../auth-info');

module.exports = route({ methods: ['GET'] }, async (ctx) => summarizeAuth(ctx));
