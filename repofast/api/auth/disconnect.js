'use strict';
// POST /api/auth/disconnect — there is no server session to destroy. The browser wipes its own
// stored token; this endpoint exists so the client flow is explicit and future-proof.
const { route } = require('../_lib/http');

module.exports = route({ methods: ['POST'], auth: false }, async () => ({ ok: true, serverState: 'none' }));
