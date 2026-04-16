const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');

const router = express.Router();

/**
 * POST /api/ai/chat
 * Body: { message, docId?, context? }
 *
 * Plug in OpenAI / Anthropic / Gemini SDK here.
 * Returns a placeholder response until an API key is configured.
 */
router.post('/chat', requireAuth, resolveOrganizationContext, requirePermission('ai.use'), (req, res) => {
  const { message, context } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  // TODO: Replace with real LLM call, e.g.:
  // const completion = await openai.chat.completions.create({ ... });
  // const reply = completion.choices[0].message.content;

  const reply = `[AI placeholder] You asked: "${message.trim()}"${context ? ' (with document context)' : ''}. Connect an LLM API key to enable real responses.`;
  res.json({ response: reply });
});

module.exports = router;
