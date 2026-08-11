const express = require('express');
const { backendRoot } = require('../lib/backend-modules');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'billing-service',
    backendRoot,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
