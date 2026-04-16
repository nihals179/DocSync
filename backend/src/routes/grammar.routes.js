const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');

const router = express.Router();

/**
 * POST /api/grammar/check
 * Body: { text }
 *
 * Returns an array of grammar/spelling/style issues.
 * Plug in LanguageTool, Grammarly API, or an LLM prompt here.
 */
router.post('/check', requireAuth, resolveOrganizationContext, requirePermission('grammar.use'), attachEntitlements, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required.' });
  }

  // TODO: Replace with real grammar check service, e.g. LanguageTool REST API:
  // const result = await fetch('https://api.languagetool.org/v2/check', { ... });

  // Placeholder: simple rule-based demo checks
  const issues = [];
  let id = 1;

  if (/\brecieve\b/i.test(text)) {
    issues.push({ id: id++, type: 'spelling', text: 'recieve', suggestion: 'receive' });
  }
  if (/\bteh\b/i.test(text)) {
    issues.push({ id: id++, type: 'spelling', text: 'teh', suggestion: 'the' });
  }
  if (/\bvery good\b/i.test(text)) {
    issues.push({ id: id++, type: 'style', text: 'very good', suggestion: 'excellent' });
  }
  if (/\b(he|she|it) go\b/i.test(text)) {
    issues.push({ id: id++, type: 'grammar', text: 'he/she/it go', suggestion: 'he/she/it goes' });
  }

  res.json({ issues });
});

module.exports = router;
