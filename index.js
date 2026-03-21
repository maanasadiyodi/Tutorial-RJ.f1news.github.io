const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const MemoryStore = require('express-session').MemoryStore;

const app = express();

// --- FIX PATH ISSUES ---
const ASSETS_DIR = path.join(__dirname, 'assets'); // Absolute path
const PUBLIC_DIR = path.join(__dirname, 'public'); // Absolute path

// Ensure directories exist with proper permissions
if (!fs.existsSync(ASSETS_DIR)) {
    console.log("Creating assets directory...");
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

if (!fs.existsSync(PUBLIC_DIR)) {
    console.log("Error: public folder not found!");
}

// Middleware
app.use(express.json());
app.use(express.static(PUBLIC_DIR)); // Serve static files from 'public'
app.use('/uploads', express.static(ASSETS_DIR)); // Serve uploaded images

// Security Configuration
const SESSION_SECRET = process.env.SESSION_SECRET || "zgallery_super_secure_key_2024"; 
const ADMIN_PASSWORD = "124"; 

// Session Configuration
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore(),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Configure Multer Storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, ASSETS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

// API: GET /images
app.get('/images', (req, res) => {
    fs.readdir(ASSETS_DIR, (err, files) => {
        if (err) {
            console.error('Error reading assets:', err);
            return res.status(500).json({ error: 'Failed to scan images' });
        }
        
        const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];
        const imageList = files.filter(f => validExtensions.includes(path.extname(f).toLowerCase()))
            .map(f => ({ name: f, url: `/uploads/${f}` }));
        
        console.log(`Found ${imageList.length} images`);
        res.json(imageList);
    });
});

// API: POST /upload
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        console.error('No file received in upload');
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = path.join(req.file.path);
    console.log(`File uploaded: ${req.file.filename}`);
    
    res.json({ message: 'Uploaded', url: `/uploads/${req.file.filename}` });
});

// API: POST /api/login
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    
    if (password === ADMIN_PASSWORD) {
        req.session.isLoggedIn = true;
        req.session.admin = true;
        
        req.session.save((err) => {
            if (err) return res.status(500).json({ error: 'Session error' });
            res.json({ success: true });
        });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// API: POST /api/logout
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'Logout error' });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// API: GET /api/auth-status
app.get('/api/auth-status', (req, res) => {
    res.json({ isLoggedIn: !!(req.session.isLoggedIn && req.session.admin) });
});

// DELETE /delete/:filename
app.delete('/delete/:filename', (req, res) => {
    if (!req.session.isLoggedIn || !req.session.admin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const fileName = decodeURIComponent(req.params.filename);
    const filePath = path.join(ASSETS_DIR, fileName);

    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) return res.status(500).json({ error: 'Delete failed' });
            console.log(`Deleted: ${fileName}`);
            res.json({ success: true });
        });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Gallery Server running at http://localhost:${PORT}`);
    console.log(`Assets folder: ${ASSETS_DIR}`);
    console.log(`Public folder: ${PUBLIC_DIR}`);
});
