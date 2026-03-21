const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// --- SECURITY & PATH SETUP ---
const ASSETS_PATH = './assets';
if (!fs.existsSync(ASSETS_PATH)) {
    fs.mkdirSync(ASSETS_PATH, { recursive: true });
}

const upload = multer({ 
    dest: 'assets/',
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('assets'));

app.use(session({
    secret: 'gallery_secret_key_2024_secure',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

app.get('/images', (req, res) => {
    fs.readdir('./assets', (err, files) => {
        if (err) return res.status(500).json({ error: 'Scan failed' });
        const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];
        const list = files.filter(f => valid.includes(path.extname(f).toLowerCase()))
            .map(f => ({ name: f, url: `/uploads/${f}` }));
        res.json(list);
    });
});

app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({ message: 'Uploaded', url: '/uploads/' + req.file.filename });
});

app.post('/api/login', (req, res) => {
    req.body.password === '124' ? 
        req.session.save(() => res.json({ success: true })) : 
        res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth-status', (req, res) => {
    res.json({ isLoggedIn: !!req.session.isLoggedIn });
});

app.delete('/delete/:filename', (req, res) => {
    if (!req.session.isLoggedIn) return res.status(403).json({ error: 'Unauthorized' });
    const filePath = path.join(__dirname, 'assets', req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, () => res.json({ success: true }));
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
