const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Example route
app.get('/', (req, res) => {
  res.send('DocSync backend running!');
});

// Placeholder for document CRUD endpoints
// app.post('/api/docs', ...)
// app.get('/api/docs/:id', ...)
// app.put('/api/docs/:id', ...)
// app.delete('/api/docs/:id', ...)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
