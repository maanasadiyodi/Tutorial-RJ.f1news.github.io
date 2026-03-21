// server.js - Optimized for Render.com
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || 'production';

// ⚠️ Render Note: Filesystem is ephemeral - files persist during runtime but reset on redeploy
// For permanent storage, integrate Cloudinary/S3 (see notes at bottom)

// Directories
const ASSETS_PATH = path.join(__dirname, 'assets');
const SESSIONS_PATH = path.join(__dirname, 'sessions');
const ensureDir = async (dir) => {
    try { await fs.mkdir(dir, { recursive: true }); } catch (e) { console.error('Dir error:', e); }
};

// Initialize directories
[ASSETS_PATH, SESSIONS_PATH].forEach(ensureDir);

// Security & Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            scriptSrc: ["'self'"],
            connectSrc: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false // Needed for some image features
}));

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});

const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: { error: 'Upload limit reached' }
});

const authLimiter = rateLimit({
    windowMs: 30 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts' }
});

app.use(apiLimiter);
app.use(express.json({ limit: '10mb' }));

// Static files - Render serves from root
app.use(express.static('public', { 
    maxAge: NODE_ENV === 'production' ? '1d' : '0',
    setHeaders: (res, filepath) => {
        if (filepath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
}));

// Serve uploaded images
app.use('/uploads', express.static(ASSETS_PATH, {
    maxAge: NODE_ENV === 'production' ? '7d' : '0',
    immutable: NODE_ENV === 'production'
}));

// Session setup (FileStore works on Render for single-instance apps)
app.use(session({
    store: new FileStore({ 
        path: SESSIONS_PATH,
        ttl: 24 * 60 * 60,
        retries: 2,
        logFn: () => {} // Suppress verbose logs
    }),
    secret: process.env.SESSION_SECRET || 'zgallery_render_secret_' + Math.random().toString(36).slice(2),
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: NODE_ENV === 'production', // Render uses HTTPS by default
        httpOnly: true, 
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

// Multer config
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
    limits: { fileSize: parseInt(process.env.MAX_UPLOAD_SIZE) || 10 * 1024 * 1024 }, // 10MB default
    fileFilter: (req, file, cb) => {
        const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (valid.includes(ext)) cb(null, true);
        else cb(new Error('Invalid file type'));
    }
});

// Helpers
const getValidImages = (files) => {
    const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    return files
        .filter(f => valid.includes(path.extname(f).toLowerCase()))
        .map(f => ({ name: f, url: `/uploads/${encodeURIComponent(f)}` }));
};

const isAuthenticated = (req, res, next) => {
    if (req.session?.isLoggedIn) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

// Routes
app.get('/images', async (req, res) => {
    try {
        const files = await fs.readdir(ASSETS_PATH).catch(() => []);
        res.json(getValidImages(files));
    } catch (err) {
        console.error('Images error:', err);
        res.status(500).json({ error: 'Failed to load gallery' });
    }
});

app.post('/upload', uploadLimiter, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) {
            console.warn('Upload failed:', err.message);
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 10MB)' });
            return res.status(400).json({ error: err.message || 'Upload failed' });
        }
        if (!req.file) return res.status(400).json({ error: 'No file provided' });
        
        res.json({ 
            success: true, 
            url: `/uploads/${encodeURIComponent(req.file.filename)}`,
            filename: req.file.filename 
        });
    });
});

app.post('/api/login', authLimiter, (req, res) => {
    const { password } = req.body || {};
    const VALID_PASS = process.env.ADMIN_PASSWORD || '124';
    
    if (password === VALID_PASS) {
        req.session.isLoggedIn = true;
        req.session.save((err) => {
            if (err) {
                console.error('Session error:', err);
                return res.status(500).json({ error: 'Login failed' });
            }
            res.json({ success: true });
        });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.clearCookie('connect.sid', {
            path: '/', httpOnly: true, secure: NODE_ENV === 'production', sameSite: 'lax'
        });
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
        
        // Security: Prevent path traversal
        if (!realPath.startsWith(ASSETS_PATH)) {
            console.warn('🚫 Path traversal blocked:', req.params.filename);
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        await fs.access(filePath);
        await fs.unlink(filePath);
        console.log('🗑️ Deleted:', filename);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(err.code === 'ENOENT' ? 404 : 500)
           .json({ error: err.code === 'ENOENT' ? 'File not found' : 'Delete failed' });
    }
});

// Health check for Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed / 1024 / 1024 + ' MB',
        env: NODE_ENV 
    });
});

// Serve index.html for all other routes (SPA fallback)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error('💥 Error:', err);
    res.status(500).json({ error: NODE_ENV === 'production' ? 'Server error' : err.message });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 Shutting down...');
    process.exit(0);
});

// Start
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT} (${NODE_ENV})`);
    if (NODE_ENV !== 'production') {
        console.log(`🔓 Dev: http://localhost:${PORT}`);
    }
});
