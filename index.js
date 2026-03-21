// server.production.js - Production Ready Version
require('dotenv').config(); // npm install dotenv

const express = require('express');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { createClient } = require('redis');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// Ensure assets directory exists
const ASSETS_PATH = path.join(__dirname, 'assets');
fs.mkdir(ASSETS_PATH, { recursive: true }).catch(console.error);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: IS_PROD ? undefined : false, // Relax CSP in dev
    crossOriginEmbedderPolicy: false // Needed for some image loaders
}));

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 100, // 100 requests per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' }
});

const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 uploads per hour
    message: { error: 'Upload limit exceeded' }
});

const authLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 30 min
    max: 5, // 5 login attempts
    message: { error: 'Too many login attempts' }
});

app.use(generalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public', { 
    maxAge: IS_PROD ? '1d' : '0',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
}));
app.use('/uploads', express.static(ASSETS_PATH, { 
    maxAge: IS_PROD ? '7d' : '0',
    immutable: IS_PROD 
}));

// Redis client setup
let redisClient;
let sessionStore;

async function initRedis() {
    if (!IS_PROD) return null; // Skip Redis in dev
    
    try {
        redisClient = createClient({ 
            url: process.env.REDIS_URL || 'redis://localhost:6379',
            socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 2000) }
        });
        
        redisClient.on('error', (err) => console.error('Redis error:', err));
        await redisClient.connect();
        
        sessionStore = new RedisStore({ 
            client: redisClient,
            prefix: 'zgallery:sess:',
            ttl: 24 * 60 * 60 // 24 hours
        });
        
        console.log('✅ Redis connected');
        return sessionStore;
    } catch (err) {
        console.error('❌ Redis connection failed:', err.message);
        console.log('⚠️ Falling back to memory store (NOT for production!)');
        return null;
    }
}

// Session middleware (initialized after Redis)
function setupSession(store) {
    return session({
        store: store || undefined, // undefined = default MemoryStore (dev only)
        secret: process.env.SESSION_SECRET || 'change_this_secret_in_production_min_32_chars',
        resave: false,
        saveUninitialized: false,
        cookie: { 
            secure: IS_PROD, // Requires HTTPS in production
            httpOnly: true, 
            maxAge: 24 * 60 * 60 * 1000,
            sameSite: IS_PROD ? 'strict' : 'lax',
            domain: IS_PROD && process.env.COOKIE_DOMAIN ? process.env.COOKIE_DOMAIN : undefined
        }
    });
}

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
    limits: { 
        fileSize: parseInt(process.env.MAX_UPLOAD_SIZE) || 5 * 1024 * 1024 // Default 5MB
    },
    fileFilter: (req, file, cb) => {
        const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (valid.includes(ext)) {
            // Optional: Add sharp for image validation here
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

// Helper functions
const getValidImages = (files) => {
    const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    return files
        .filter(f => valid.includes(path.extname(f).toLowerCase()))
        .map(f => ({ name: f, url: `/uploads/${encodeURIComponent(f)}` }));
};

const isAuthenticated = (req, res, next) => {
    if (req.session?.isLoggedIn) return next();
    res.status(401).json({ error: 'Authentication required' });
};

// Routes
app.get('/images', async (req, res) => {
    try {
        const files = await fs.readdir(ASSETS_PATH);
        res.json(getValidImages(files));
    } catch (err) {
        console.error('Images fetch error:', err);
        res.status(500).json({ error: 'Failed to load images' });
    }
});

app.post('/upload', uploadLimiter, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) {
            console.warn('Upload error:', err.message);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large' });
            }
            return res.status(400).json({ error: err.message || 'Upload failed' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }
        res.json({ 
            success: true, 
            url: `/uploads/${encodeURIComponent(req.file.filename)}`,
            filename: req.file.filename,
            size: req.file.size
        });
    });
});

app.post('/api/login', authLimiter, (req, res) => {
    const { password } = req.body || {};
    
    // 🔐 In production: Use environment variable or database!
    const VALID_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!VALID_PASSWORD && IS_PROD) {
        console.error('❌ ADMIN_PASSWORD not set in production!');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    
    if (password === (VALID_PASSWORD || '124')) {
        req.session.isLoggedIn = true;
        req.session.save((err) => {
            if (err) {
                console.error('Session save failed:', err);
                return res.status(500).json({ error: 'Login failed' });
            }
            console.log('✅ User logged in');
            res.json({ success: true });
        });
    } else {
        console.warn('❌ Failed login attempt');
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.clearCookie('connect.sid', {
            path: '/',
            httpOnly: true,
            secure: IS_PROD,
            sameSite: IS_PROD ? 'strict' : 'lax'
        });
        res.json({ success: true });
    });
});

app.get('/api/auth-status', (req, res) => {
    res.json({ 
        isLoggedIn: !!req.session?.isLoggedIn,
        env: NODE_ENV
    });
});

app.delete('/delete/:filename', isAuthenticated, async (req, res) => {
    try {
        const filename = path.basename(req.params.filename);
        const filePath = path.join(ASSETS_PATH, filename);
        const realPath = path.resolve(filePath);
        
        // Security: Ensure path is within assets folder
        if (!realPath.startsWith(ASSETS_PATH)) {
            console.warn('🚫 Path traversal attempt:', req.params.filename);
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        await fs.access(filePath);
        await fs.unlink(filePath);
        console.log('🗑️ Deleted:', filename);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete error:', err);
        if (err.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else {
            res.status(500).json({ error: 'Deletion failed' });
        }
    }
});

// Health & metrics
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        env: NODE_ENV
    });
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('💥 Unhandled error:', err);
    res.status(500).json({ 
        error: IS_PROD ? 'Internal error' : err.message,
        ...(IS_PROD ? {} : { stack: err.stack })
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🔄 Shutting down gracefully...');
    if (redisClient?.isReady) {
        await redisClient.quit();
    }
    process.exit(0);
});

// Start server
async function start() {
    const store = await initRedis();
    app.use(setupSession(store));
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT} (${NODE_ENV})`);
        if (!IS_PROD) {
            console.log(`🔓 Dev mode: http://localhost:${PORT}`);
        }
    });
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
