const express = require('express');
const cors = require('cors');
const contactRoutes = require('./routes/contact');

const app = express();
const PORT = 9999;

app.use(cors());
app.use(express.json());
app.use('/api/contact', contactRoutes);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});