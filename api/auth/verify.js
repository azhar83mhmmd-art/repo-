'use strict';
// GET /api/auth/verify — re-validates the token held by the browser (stateless).
const { route } = require('../_lib/http');
const { summarizeAuth } = require('../_lib/auth-info');

module.exports = route({ methods: ['GET'] }, async (ctx) => summarizeAuth(ctx));
