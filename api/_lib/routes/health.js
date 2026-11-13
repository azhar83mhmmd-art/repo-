'use strict';
// GET /api/health — open in a browser to check that the RepoFast API is deployed.
const { route } = require('../http');
module.exports = route({ methods: ['GET'], auth: false }, async () => ({ ok: true, service: 'repofast-api' }));
