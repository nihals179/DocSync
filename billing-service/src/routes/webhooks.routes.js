const express = require('express');
const { requireServiceAuth } = require('../middleware/service-auth');
const { processDueWebhookJobs, queueBillingEvent } = require('../billing/service');

const router = express.Router();

function hasValidPostgresUrl() {
  const value = String(process.env.DATABASE_URL || '').trim().toLowerCase();
  return value.startsWith('postgres://') || value.startsWith('postgresql://');
}

router.use(requireServiceAuth);
router.use((req, res, next) => {
  if (!hasValidPostgresUrl()) {
    return res.status(503).json({
      error: 'Billing database is not configured. Set DATABASE_URL to postgres:// or postgresql://.',
      code: 'billing_database_not_configured',
    });
  }

  return next();
});

router.post('/provider', async (req, res) => {
  const event = req.body || {};
  if (!event.type) {
    return res.status(400).json({ error: 'Webhook payload must include event type.' });
  }

  const queued = queueBillingEvent(event, 'provider');
  if (queued.skipped) {
    return res.status(200).json({
      message: 'Webhook already processed or queued.',
      eventId: queued.eventId,
      status: queued.reason,
    });
  }

  await processDueWebhookJobs(20);
  return res.status(202).json({
    message: 'Webhook accepted for processing.',
    eventId: queued.eventId,
    jobId: queued.job?.id || null,
  });
});

module.exports = router;
