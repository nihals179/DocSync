const express = require('express');

const { processDueWebhookJobs, queueBillingEvent } = require('../billing/service');

const router = express.Router();

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
