const express = require('express');
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
		console.log("Creating assets folder...");
		fs.mkdirSync('./assets');
}

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

const upload = multer({ 
		storage: storage,
		limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
		fileFilter: function (req, file, cb) {
				checkFileType(file, cb);
		}
});

function checkFileType(file, cb) {
		const allowedExt = /jpeg|jpg|png|gif|bmp/;
		const extname = allowedExt.test(path.extname(file.originalname).toLowerCase());
		const mimetype = allowedExt.test(path.extname(file.originalname).toLowerCase()) || 
										 /image\/(jpeg|jpg|png|gif|bmp)/.test(file.mimetype);

		if (mimetype && extname) {
				return cb(null, true);
		} else {
				cb(new Error('Only images are allowed!'));
		}
}

// --- SIMPLE UPLOAD ROUTE (No Chunks) ---
app.post('/upload', upload.single('image'), (req, res) => {
		try {
				if (!req.file) {
						return res.status(400).json({ error: 'No file uploaded' });
				}

				console.log(`File uploaded: ${req.file.filename}`);
				res.json({ 
						message: 'File uploaded successfully', 
						url: '/uploads/' + req.file.filename 
				});
		} catch (err) {
				console.error('Upload Error:', err);
				res.status(500).json({ error: 'Server error during upload' });
		}
});

// --- GET IMAGES ---
app.get('/images', (req, res) => {
		fs.readdir('./assets', (err, files) => {
				if (err) return res.status(500).json({ error: 'Scan failed' });
				const valid = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];
				const list = files.filter(f => valid.includes(path.extname(f).toLowerCase()))
						.map(f => ({ name: f, url: `/uploads/${f}` }));
				res.json(list);
		});
});

// --- SINGLE DELETE ---
app.delete('/delete/:filename', (req, res) => {
		const fileName = decodeURIComponent(req.params.filename);
		const filePath = path.join(__dirname, 'assets', fileName);
		const tempPath = path.join(__dirname, 'assets', fileName + '.tmp');

		if (fs.existsSync(filePath)) {
				fs.unlink(filePath, (err) => {
						if (err) return res.status(500).json({ error: 'Error' });
						res.json({ success: true });
				});
		} else if (fs.existsSync(tempPath)) {
				fs.unlink(tempPath, (err) => {
						if (err) return res.status(500).json({ error: 'Error' });
						res.json({ success: true });
				});
		} else {
				res.json({ success: true }); 
		}
});

// --- BULK DELETE ---
app.post('/delete-multiple', (req, res) => {
		const { filenames } = req.body;
		if (!Array.isArray(filenames)) return res.status(400).json({ error: 'Invalid input' });

		let successCount = 0;

		filenames.forEach(fileName => {
				const filePath = path.join(__dirname, 'assets', fileName);
				const tempPath = path.join(__dirname, 'assets', fileName + '.tmp');

				if (fs.existsSync(filePath)) {
						fs.unlinkSync(filePath);
						successCount++;
				} else if (fs.existsSync(tempPath)) {
						fs.unlinkSync(tempPath);
						successCount++;
				}
		});

		res.json({ success: true, message: `${successCount} deleted` });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
