const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- FIX SESSION WARNING ---
// Explicitly import MemoryStore to suppress the warning
const MemoryStore = session.MemoryStore;

const app = express();
const PORT = process.env.PORT || 8080;

// Ensure assets directory exists immediately
const ASSETS_PATH = './assets';
if (!fs.existsSync(ASSETS_PATH)) {
    fs.mkdirSync(ASSETS_PATH, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(express.static('public')); // Serve HTML/CSS/JS
app.use('/uploads', express.static('assets')); // Serve Images

// Configure Session (Explicitly using MemoryStore to fix warning)
app.use(session({
    secret: 'zgallery_secret_key_2024_secure',
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore(), // <--- This line fixes the warning
    cookie: { 
        secure: false, 
        httpOnly: true, 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Configure Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'assets/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// API: GET /images
app.get('/images', (req, res) => {
    fs.readdir('./assets', (err, files) => {
        if (err) return res.status(500).json({ error: 'Scan failed' });
        
        const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];
        const list = files.filter(f => valid.includes(path.extname(f).toLowerCase()))
            .map(f => ({ name: f, url: `/uploads/${f}` }));
        
        console.log(`Loaded ${list.length} images.`); // Debug log
        res.json(list);
    });
});

// API: POST /upload
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({ message: 'Uploaded', url: '/uploads/' + req.file.filename });
});

// API: POST /api/login
app.post('/api/login', (req, res) => {
    req.body.password === '124' ? 
        req.session.save(() => res.json({ success: true })) : 
        res.status(401).json({ error: 'Invalid password' });
});

// API: POST /api/logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// API: GET /api/auth-status
app.get('/api/auth-status', (req, res) => {
    res.json({ isLoggedIn: !!req.session.isLoggedIn });
});

// API: DELETE /delete/:filename
app.delete('/delete/:filename', (req, res) => {
    if (!req.session.isLoggedIn) return res.status(403).json({ error: 'Unauthorized' });
    
    const filePath = path.join(__dirname, 'assets', req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, () => res.json({ success: true }));
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
