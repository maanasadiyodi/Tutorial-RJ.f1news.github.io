const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('assets'));

// Ensure assets folder exists
if (!fs.existsSync('./assets')) {
		fs.mkdirSync('./assets');
}

// --- SECURITY CONFIGURATION ---
const SESSION_SECRET = "zgallery_super_secure_key_change_in_prod_2024"; 
const ADMIN_PASSWORD = "124"; 

// Configure Session
app.use(session({
		secret: SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		cookie: {
				secure: false, 
				httpOnly: true, 
				maxAge: 24 * 60 * 60 * 1000 
		}
}));

// Configure Storage
const storage = multer.diskStorage({
		destination: function (req, file, cb) {
				cb(null, 'assets/');
		},
		filename: function (req, file, cb) {
				const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
				cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
		}
});

const upload = multer({ storage });

// --- API: GET /images ---
app.get('/images', (req, res) => {
		fs.readdir('./assets', (err, files) => {
				if (err) return res.status(500).json({ error: 'Scan failed' });
				const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];
				const list = files.filter(f => valid.includes(path.extname(f).toLowerCase()))
						.map(f => ({ name: f, url: `/uploads/${f}` }));
				res.json(list);
		});
});

// --- API: POST /upload ---
app.post('/upload', upload.single('image'), (req, res) => {
		if (!req.file) return res.status(400).json({ error: 'No file' });
		res.json({ message: 'Uploaded', url: '/uploads/' + req.file.filename });
});

// --- SECURE LOGIN ROUTE ---
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

// --- SECURE LOGOUT ROUTE ---
app.post('/api/logout', (req, res) => {
		req.session.destroy((err) => {
				if (err) return res.status(500).json({ error: 'Logout error' });
				res.clearCookie('connect.sid');
				res.json({ success: true });
		});
});

// --- CHECK AUTH STATUS ---
app.get('/api/auth-status', (req, res) => {
		res.json({ 
				isLoggedIn: !!(req.session.isLoggedIn && req.session.admin) 
		});
});

// --- SECURE DELETE ROUTE ---
app.delete('/delete/:filename', (req, res) => {
		if (!req.session.isLoggedIn || !req.session.admin) {
				return res.status(403).json({ error: 'Unauthorized: Login required.' });
		}

		const fileName = decodeURIComponent(req.params.filename);
		const filePath = path.join(__dirname, 'assets', fileName);

		if (fs.existsSync(filePath)) {
				fs.unlink(filePath, (err) => {
						if (err) return res.status(500).json({ error: 'Error deleting' });
						res.json({ success: true });
				});
		} else {
				res.status(404).json({ error: 'File not found' });
		}
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
