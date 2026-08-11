const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/health.routes');
const billingRoutes = require('./routes/billing.routes');
const webhookRoutes = require('./routes/webhooks.routes');
const { startBillingWebhookWorker } = require('./billing/service');

const app = express();

function hasValidPostgresUrl() {
  const value = String(process.env.DATABASE_URL || '').trim().toLowerCase();
  return value.startsWith('postgres://') || value.startsWith('postgresql://');
}

const allowedOrigins = new Set();
const corsOrigins = String(process.env.CORS_ORIGINS || '').trim();
if (corsOrigins) {
  corsOrigins.split(',').map((item) => item.trim()).filter(Boolean).forEach((origin) => {
    allowedOrigins.add(origin);
  });
}

app.use(cors({
  origin(origin, cb) {
    if (!origin || !allowedOrigins.size) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/', healthRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/billing/webhooks', webhookRoutes);

if (hasValidPostgresUrl()) {
  startBillingWebhookWorker();
} else {
  console.warn('Billing webhook worker not started: set DATABASE_URL to a postgres:// or postgresql:// value.');
}

module.exports = app;
