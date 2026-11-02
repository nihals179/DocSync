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
const editorRoutes = require('./routes/editor.routes');
const aiRoutes = require('./routes/ai.routes');
const grammarRoutes = require('./routes/grammar.routes');
const workspacesRoutes = require('./routes/workspaces.routes');
const templatesRoutes = require('./routes/templates.routes');
const tenantsRoutes = require('./routes/tenants.routes');
const enterpriseSecurityRoutes = require('./routes/enterprise-security.routes');
const usersRoutes = require('./routes/users.routes');
const billingRoutes = require('./routes/billing.routes');
const billingWebhooksRoutes = require('./routes/billing-webhooks.routes');
const openApiSpec = require('./openapi');
const swaggerUiAutoAuthScript = require('./swagger-ui-auto-auth');
const swaggerUi = require('swagger-ui-express');

const app = express();

const allowedOrigins = new Set([
	'http://localhost:5173',
	'http://localhost:5174',
	'http://127.0.0.1:5173',
	'http://127.0.0.1:5174',
	'http://localhost:4173',
	'http://127.0.0.1:4173',
	'http://localhost:4000',
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

app.get(['/openapi.json', '/api/openapi.json', '/swagger.json'], (_req, res) => {
	res.json(openApiSpec);
});

app.get('/swagger-ui/swagger-auto-auth.js', (_req, res) => {
	res.type('application/javascript').send(swaggerUiAutoAuthScript);
});

app.use('/swagger-ui', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
	documentTitle: 'DocSync API Swagger',
	customJs: '/swagger-ui/swagger-auto-auth.js',
	swaggerOptions: {
		displayRequestDuration: true,
		persistAuthorization: true,
	},
}));

app.get('/swagger', (_req, res) => {
	res.redirect('/swagger-ui');
});

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

// Editor bootstrap
app.use('/api/editor', editorRoutes);

// Workspaces
app.use('/api/workspaces', workspacesRoutes);

// Templates
app.use('/api/templates', templatesRoutes);

// Tenants
app.use('/api/tenants', tenantsRoutes);

// Enterprise security and audit console
app.use('/api/tenants', enterpriseSecurityRoutes);

// Users
app.use('/api/users', usersRoutes);

// Billing portal and plan management
app.use('/api/billing', billingRoutes);

// Billing webhooks (provider callbacks)
app.use('/api/billing/webhooks', billingWebhooksRoutes);

// Document-scoped resources (mergeParams enabled on each router)
app.use('/api/docs/:docId/comments', commentsRoutes);
app.use('/api/docs/:docId/versions', versionsRoutes);
app.use('/api/docs/:docId/todos', todosRoutes);

// Tenant-scoped version listing
app.use('/api/versions', versionsRoutes);

// AI & Grammar
app.use('/api/ai', aiRoutes);
app.use('/api/grammar', grammarRoutes);

// Final error handler: every unhandled error (including rejected async route handlers,
// which Express 5 forwards here) becomes a JSON response instead of Express's default
// HTML page, which includes the stack trace outside production.
app.use((err, req, res, next) => {
	if (err?.type === 'entity.parse.failed') {
		return res.status(400).json({ error: 'Malformed JSON request body.' });
	}
	if (err?.type === 'entity.too.large') {
		return res.status(413).json({ error: 'Request body is too large.' });
	}

	const status = Number(err?.status || err?.statusCode);
	if (status >= 400 && status < 500) {
		return res.status(status).json({ error: err.expose === false ? 'Bad request.' : String(err.message || 'Bad request.') });
	}

	console.error(`[${req.method} ${req.originalUrl}]`, err);
	if (res.headersSent) return next(err);
	return res.status(500).json({
		error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : String(err?.message || err),
	});
});

module.exports = app;
