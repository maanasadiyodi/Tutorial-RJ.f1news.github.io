const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 8080;

const ASSETS_PATH = path.join(__dirname, 'assets');
const SESSIONS_PATH = path.join(__dirname, 'sessions');

const ensureDir = async (dir) => {
    try { await fs.mkdir(dir, { recursive: true }); } catch (e) {}
};
[ASSETS_PATH, SESSIONS_PATH].forEach(ensureDir);

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static(ASSETS_PATH));

app.use(session({
    store: new FileStore({ 
        path: SESSIONS_PATH, 
        ttl: 24 * 60 * 60, 
        retries: 2, 
        logFn: () => {} 
    }),
    secret: 'render_super_secret_key_2024_abcdefghijklmnopqrstuvwxyz1234567890xyz',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, 
        httpOnly: true, 
        maxAge: 24 * 60 * 60 * 1000, 
        sameSite: 'lax' 
    }
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, ASSETS_PATH),
    filename: (req, file, cb) => {
        const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `img-${unique}${ext}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (valid.includes(ext)) cb(null, true);
        else cb(new Error('Invalid file type'));
    }
});

const getValidImages = (files) => {
    const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    return files.filter(f => valid.includes(path.extname(f).toLowerCase())).map(f => ({ name: f, url: `/uploads/${encodeURIComponent(f)}` }));
};

const isAuthenticated = (req, res, next) => {
    if (req.session?.isLoggedIn) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

app.get('/images', async (req, res) => {
    try {
        const files = await fs.readdir(ASSETS_PATH).catch(() => []);
        res.json(getValidImages(files));
    } catch (err) {
        res.status(500).json({ error: 'Failed to load gallery' });
    }
});

app.post('/upload', (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
            return res.status(400).json({ error: err.message || 'Upload failed' });
        }
        if (!req.file) return res.status(400).json({ error: 'No file provided' });
        res.json({ success: true, url: `/uploads/${encodeURIComponent(req.file.filename)}`, filename: req.file.filename });
    });
});

app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (password === '124') {
        req.session.isLoggedIn = true;
        req.session.save((err) => {
            if (err) return res.status(500).json({ error: 'Login failed' });
            res.json({ success: true });
        });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.get('/api/auth-status', (req, res) => {
    res.json({ isLoggedIn: !!req.session?.isLoggedIn });
});

app.delete('/delete/:filename', isAuthenticated, async (req, res) => {
    try {
        const filename = path.basename(req.params.filename);
        const filePath = path.join(ASSETS_PATH, filename);
        const realPath = path.resolve(filePath);
        if (!realPath.startsWith(ASSETS_PATH)) return res.status(400).json({ error: 'Invalid request' });
        await fs.access(filePath);
        await fs.unlink(filePath);
        res.json({ success: true });
    } catch (err) {
        res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: err.code === 'ENOENT' ? 'File not found' : 'Delete failed' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
