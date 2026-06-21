'use strict';
const express = require('express');

const app = express();

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`backend listening on ${PORT}`));
}

module.exports = { app };
