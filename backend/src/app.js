const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const docsRoutes = require('./routes/docs.routes');
const commentsRoutes = require('./routes/comments.routes');
const versionsRoutes = require('./routes/versions.routes');
const todosRoutes = require('./routes/todos.routes');
const aiRoutes = require('./routes/ai.routes');
const grammarRoutes = require('./routes/grammar.routes');
const workspacesRoutes = require('./routes/workspaces.routes');
const organizationsRoutes = require('./routes/organizations.routes');

const app = express();

app.use(cors({
	origin: process.env.FRONTEND_URL || 'http://localhost:5173',
	credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// Health check
app.use('/', healthRoutes);

// Auth
app.use('/api/auth', authRoutes);

// Documents
app.use('/api/docs', docsRoutes);

// Workspaces
app.use('/api/workspaces', workspacesRoutes);

// Organizations
app.use('/api/organizations', organizationsRoutes);

// Document-scoped resources (mergeParams enabled on each router)
app.use('/api/docs/:docId/comments', commentsRoutes);
app.use('/api/docs/:docId/versions', versionsRoutes);
app.use('/api/docs/:docId/todos', todosRoutes);

// AI & Grammar
app.use('/api/ai', aiRoutes);
app.use('/api/grammar', grammarRoutes);

module.exports = app;
