const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => {
  res.send('DocSync backend running!');
});

module.exports = router;
