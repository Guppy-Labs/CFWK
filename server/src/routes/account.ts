import express from 'express';
import passport from 'passport';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import User from '../models/User';

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../../uploads/avatars');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const userId = (req.user as any).id;
        const ext = path.extname(file.originalname);
        cb(null, `${userId}-${Date.now()}${ext}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only images (jpeg, jpg, png, gif, webp) are allowed'));
    }
});

function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: 'Not authenticated' });
}

router.use(isAuthenticated);

// --- Linking Routes ---
router.get('/link/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/link/discord', passport.authenticate('discord', { scope: ['identify', 'email'] }));

// --- Upload Avatar ---
router.post('/avatar', (req, res, next) => {
    upload.single('avatar')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ message: err.message });
        } else if (err) {
            return res.status(400).json({ message: err.message });
        }
        
        if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

        try {
            const user = await User.findById((req.user as any).id);
            if (!user) return res.status(404).json({ message: 'User not found' });

            const publicUrl = `/uploads/avatars/${req.file.filename}`;
            user.profilePic = publicUrl;
            await user.save();

            res.json({ message: 'Avatar updated', profilePic: publicUrl });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: 'Server error' });
        }
    });
});

// --- Change Username ---
router.post('/username', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username || typeof username !== 'string') return res.status(400).json({ message: 'Invalid username' });
        
        const user = await User.findById((req.user as any).id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Cooldown check (14 days)
        if (user.lastUsernameChange) {
            const daysSince = (Date.now() - user.lastUsernameChange.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince < 14) {
                return res.status(400).json({ message: 'Username change cooldown active (14 days).' });
            }
        }

        // Uniqueness check
        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ message: 'Username taken' });

        user.username = username;
        user.lastUsernameChange = new Date();
        await user.save();

        res.json({ message: 'Username updated', user });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- Update Status ---
router.post('/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (typeof status !== 'string' || status.length > 100) {
             return res.status(400).json({ message: 'Invalid status (max 100 chars)' });
        }

        const user = await User.findById((req.user as any).id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.status = status;
        await user.save();

        res.json({ message: 'Status updated' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- Change Password ---
router.post('/password', async (req, res) => {
    try {
        const { password, currentPassword } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ message: 'Password too short (min 6 chars)' });
        }

        const user = await User.findById((req.user as any).id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // If user HAS a password, they must provide current one
        if (user.password) {
            if (!currentPassword) {
                return res.status(400).json({ message: 'Current password required' });
            }
            const match = await bcrypt.compare(currentPassword, user.password);
            if (!match) {
                 return res.status(401).json({ message: 'Incorrect current password' });
            }
        }

        const hashed = await bcrypt.hash(password, 10);
        user.password = hashed;
        await user.save();

        res.json({ message: 'Password updated' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;
