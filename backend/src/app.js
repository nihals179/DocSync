const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const sessionsRoutes = require('./routes/sessions.routes');
const securityRoutes = require('./routes/security.routes');
const docsRoutes = require('./routes/docs.routes');
const commentsRoutes = require('./routes/comments.routes');
const versionsRoutes = require('./routes/versions.routes');
const todosRoutes = require('./routes/todos.routes');
const aiRoutes = require('./routes/ai.routes');
const grammarRoutes = require('./routes/grammar.routes');
const workspacesRoutes = require('./routes/workspaces.routes');
const templatesRoutes = require('./routes/templates.routes');
const organizationsRoutes = require('./routes/organizations.routes');
const enterpriseSecurityRoutes = require('./routes/enterprise-security.routes');
const billingRoutes = require('./routes/billing.routes');
const billingWebhooksRoutes = require('./routes/billing-webhooks.routes');

const app = express();

const allowedOrigins = new Set([
	'http://localhost:5173',
	'http://localhost:5174',
	'http://127.0.0.1:5173',
	'http://127.0.0.1:5174',
	'http://localhost:4173',
	'http://127.0.0.1:4173',
]);

if (process.env.FRONTEND_URL) {
	allowedOrigins.add(process.env.FRONTEND_URL);
}

app.use(cors({
	origin(origin, cb) {
		if (!origin) return cb(null, true);
		if (allowedOrigins.has(origin)) return cb(null, true);
		return cb(new Error(`CORS blocked for origin: ${origin}`));
	},
	credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.use('/', healthRoutes);

// Auth
app.use('/api/auth', authRoutes);

// Session lifecycle endpoints
app.use('/api/sessions', sessionsRoutes);

// Backward compatibility for existing auth session endpoints
app.use('/api/auth', sessionsRoutes);

// Security endpoints
app.use('/api/security', securityRoutes);

// Backward compatibility for existing auth security endpoints
app.use('/api/auth', securityRoutes);

// Documents
app.use('/api/docs', docsRoutes);

// Workspaces
app.use('/api/workspaces', workspacesRoutes);

// Templates
app.use('/api/templates', templatesRoutes);

// Organizations
app.use('/api/organizations', organizationsRoutes);

// Enterprise security and audit console
app.use('/api/organizations', enterpriseSecurityRoutes);

// Billing portal and plan management
app.use('/api/billing', billingRoutes);

// Billing webhooks (provider callbacks)
app.use('/api/billing/webhooks', billingWebhooksRoutes);

// Document-scoped resources (mergeParams enabled on each router)
app.use('/api/docs/:docId/comments', commentsRoutes);
app.use('/api/docs/:docId/versions', versionsRoutes);
app.use('/api/docs/:docId/todos', todosRoutes);

// AI & Grammar
app.use('/api/ai', aiRoutes);
app.use('/api/grammar', grammarRoutes);

module.exports = app;
