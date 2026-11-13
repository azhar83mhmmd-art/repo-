'use strict';
// POST /api/auth/connect — validates a token the user pasted. The token arrives in the
// Authorization header, is checked against GitHub, and is NOT stored anywhere on the server.
const { route } = require('../../http');
const { summarizeAuth } = require('../../auth-info');

module.exports = route({ methods: ['POST'] }, async (ctx) => summarizeAuth(ctx));
