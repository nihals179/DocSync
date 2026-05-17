const { canConsumeAiRequests, consumeAiRequests } = require('../../store');

function ensureOrganizationContext(req, res) {
  if (!req.organization?.id) {
    res.status(500).json({ error: 'Organization context missing.' });
    return false;
  }
  return true;
}

async function requireAiQuota(req, res, next) {
  if (!ensureOrganizationContext(req, res)) return;

  const check = await canConsumeAiRequests(req.organization.id, 1);
  if (!check.allowed) {
    return res.status(402).json({
      error: check.reason,
      code: 'ai_quota_exceeded',
      details: {
        current: check.usage?.aiRequests || null,
        limit: check.limit || null,
      },
    });
  }

  return next();
}

async function consumeAiQuota(req, res, next) {
  if (!ensureOrganizationContext(req, res)) return;

  const result = await consumeAiRequests(req.organization.id, 1);
  if (!result.allowed) {
    return res.status(402).json({
      error: result.reason,
      code: 'ai_quota_exceeded',
    });
  }

  req.aiUsage = result.usage;
  return next();
}

module.exports = {
  requireAiQuota,
  consumeAiQuota,
};
