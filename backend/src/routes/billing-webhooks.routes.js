const express = require('express');
const { requestBillingService } = require('../lib/billing-service-client');

const router = express.Router();

router.post('/provider', async (req, res) => {
  try {
    const response = await requestBillingService('/api/billing/webhooks/provider', {
      method: 'POST',
      body: req.body || {},
    });
    return res.status(response.status).json(response.payload);
  } catch (error) {
    return res.status(502).json({
      error: 'Billing service is unavailable.',
      code: 'billing_service_unavailable',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

module.exports = router;
