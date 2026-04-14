const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/health.routes');
const docsRoutes = require('./routes/docs.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/', healthRoutes);
app.use('/api/docs', docsRoutes);

module.exports = app;
