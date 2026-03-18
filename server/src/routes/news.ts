import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import mongoose from 'mongoose';
import NewsPost, { NewsClassification } from '../models/NewsPost';
import User from '../models/User';
import { normalizeUsername } from '../utils/username';

const router = express.Router();

type ResolvedAuthor = {
    authorUserId: mongoose.Types.ObjectId | null;
    authorUsernameSnapshot: string | null;
};

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        const dir = path.join(__dirname, '../../uploads/news');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${Date.now()}_${safeName}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const extAllowed = allowed.test(path.extname(file.originalname).toLowerCase());
        const mimeAllowed = allowed.test(file.mimetype);
        if (extAllowed && mimeAllowed) {
            cb(null, true);
            return;
        }
        cb(new Error('Only image uploads are allowed (jpeg, jpg, png, gif, webp).'));
    }
});

function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    return res.status(401).json({ message: 'Not authenticated' });
}

async function isGameAdmin(req: express.Request): Promise<boolean> {
    if (!req.isAuthenticated || !req.isAuthenticated()) return false;
    const userId = (req.user as any)?.id || (req.user as any)?._id;
    if (!userId) return false;

    const user = await User.findById(userId).select('permissions');
    return Boolean(user && Array.isArray(user.permissions) && user.permissions.includes('game.admin'));
}

async function requireGameAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const allowed = await isGameAdmin(req);
    if (!allowed) {
        return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
}

function parseClassification(input: unknown): NewsClassification | null {
    if (typeof input !== 'string') return null;
    if (input === 'RELEASE' || input === 'OTHER') return input;
    return null;
}

function parseOptionalDate(input: unknown): Date | null | undefined {
    if (input === undefined || input === null || input === '') return undefined;
    if (typeof input !== 'string') return null;
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

async function resolveAuthor(authorInput: unknown): Promise<ResolvedAuthor | null> {
    if (authorInput === undefined || authorInput === null || authorInput === '') {
        return { authorUserId: null, authorUsernameSnapshot: null };
    }
    if (typeof authorInput !== 'string') return null;

    const candidate = authorInput.trim();
    if (!candidate) {
        return { authorUserId: null, authorUsernameSnapshot: null };
    }

    let foundUser = null;
    if (mongoose.Types.ObjectId.isValid(candidate)) {
        foundUser = await User.findById(candidate).select('_id username');
    }

    if (!foundUser) {
        const normalized = normalizeUsername(candidate);
        foundUser = await User.findOne({ username: normalized }).select('_id username');
    }

    if (!foundUser && candidate.includes('@')) {
        foundUser = await User.findOne({ email: candidate.toLowerCase() }).select('_id username');
    }

    if (!foundUser || !foundUser.username) return null;

    return {
        authorUserId: foundUser._id as mongoose.Types.ObjectId,
        authorUsernameSnapshot: foundUser.username
    };
}

function toPublicPost(post: any) {
    return {
        _id: String(post._id),
        title: post.title,
        content: post.content,
        classification: post.classification,
        imageUrl: post.imageUrl || undefined,
        authorUsernameSnapshot: post.authorUsernameSnapshot || undefined,
        publishAt: post.publishAt || undefined,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt
    };
}

function sortPostsByDisplayDate(posts: any[]) {
    return posts.sort((a, b) => {
        const aTime = new Date(a.publishAt || a.createdAt).getTime();
        const bTime = new Date(b.publishAt || b.createdAt).getTime();
        return bTime - aTime;
    });
}

function deleteImageIfExists(imageUrl: string | undefined) {
    if (!imageUrl) return;
    if (!imageUrl.startsWith('/uploads/news/')) return;
    const relativeImagePath = imageUrl.replace(/^\/+/, '');
    const imagePath = path.join(__dirname, '..', relativeImagePath);
    if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
    }
}

router.use(isAuthenticated);

router.get('/', async (_req, res) => {
    try {
        const posts = await NewsPost.find().lean();
        const ordered = sortPostsByDisplayDate(posts).map(toPublicPost);
        return res.json({ posts: ordered });
    } catch (error) {
        console.error('[News] Failed to list posts:', error);
        return res.status(500).json({ message: 'Failed to load posts' });
    }
});

router.get('/:id', requireGameAdmin, async (req, res) => {
    try {
        const post = await NewsPost.findById(req.params.id).lean();
        if (!post) return res.status(404).json({ message: 'Post not found' });
        return res.json({ post: toPublicPost(post) });
    } catch (error) {
        console.error('[News] Failed to load post:', error);
        return res.status(500).json({ message: 'Failed to load post' });
    }
});

router.post('/', requireGameAdmin, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ message: err.message });
        }
        if (err) {
            return res.status(400).json({ message: (err as Error).message });
        }

        try {
            const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
            const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
            const classification = parseClassification(req.body.classification);
            const parsedDate = parseOptionalDate(req.body.publishAt);
            const resolvedAuthor = await resolveAuthor(req.body.author);

            if (!title || title.length > 140) {
                return res.status(400).json({ message: 'Title is required and must be 140 chars or less.' });
            }
            if (!content || content.length > 10000) {
                return res.status(400).json({ message: 'Content is required and must be 10000 chars or less.' });
            }
            if (!classification) {
                return res.status(400).json({ message: 'Classification must be RELEASE or OTHER.' });
            }
            if (parsedDate === null) {
                return res.status(400).json({ message: 'Invalid publish date.' });
            }
            if (resolvedAuthor === null) {
                return res.status(400).json({ message: 'Author must be an existing registered user.' });
            }

            const post = new NewsPost({
                title,
                content,
                classification,
                imageUrl: req.file ? `/uploads/news/${req.file.filename}` : undefined,
                authorUserId: resolvedAuthor.authorUserId,
                authorUsernameSnapshot: resolvedAuthor.authorUsernameSnapshot,
                publishAt: parsedDate === undefined ? undefined : parsedDate
            });
            await post.save();
            return res.status(201).json({ post: toPublicPost(post.toObject()) });
        } catch (error) {
            console.error('[News] Failed to create post:', error);
            return res.status(500).json({ message: 'Failed to create post' });
        }
    });
});

router.put('/:id', requireGameAdmin, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ message: err.message });
        }
        if (err) {
            return res.status(400).json({ message: (err as Error).message });
        }

        try {
            const post = await NewsPost.findById(req.params.id);
            if (!post) return res.status(404).json({ message: 'Post not found' });

            const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
            const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
            const classification = parseClassification(req.body.classification);
            const parsedDate = parseOptionalDate(req.body.publishAt);
            const resolvedAuthor = await resolveAuthor(req.body.author);
            const removeImage = req.body.removeImage === 'true' || req.body.removeImage === true;

            if (!title || title.length > 140) {
                return res.status(400).json({ message: 'Title is required and must be 140 chars or less.' });
            }
            if (!content || content.length > 10000) {
                return res.status(400).json({ message: 'Content is required and must be 10000 chars or less.' });
            }
            if (!classification) {
                return res.status(400).json({ message: 'Classification must be RELEASE or OTHER.' });
            }
            if (parsedDate === null) {
                return res.status(400).json({ message: 'Invalid publish date.' });
            }
            if (resolvedAuthor === null) {
                return res.status(400).json({ message: 'Author must be an existing registered user.' });
            }

            post.title = title;
            post.content = content;
            post.classification = classification;
            post.authorUserId = resolvedAuthor.authorUserId || undefined;
            post.authorUsernameSnapshot = resolvedAuthor.authorUsernameSnapshot || undefined;

            if (parsedDate === undefined) {
                post.publishAt = undefined;
            } else {
                post.publishAt = parsedDate;
            }

            if (req.file) {
                deleteImageIfExists(post.imageUrl);
                post.imageUrl = `/uploads/news/${req.file.filename}`;
            } else if (removeImage) {
                deleteImageIfExists(post.imageUrl);
                post.imageUrl = undefined;
            }

            await post.save();
            return res.json({ post: toPublicPost(post.toObject()) });
        } catch (error) {
            console.error('[News] Failed to update post:', error);
            return res.status(500).json({ message: 'Failed to update post' });
        }
    });
});

router.delete('/:id', requireGameAdmin, async (req, res) => {
    try {
        const post = await NewsPost.findById(req.params.id);
        if (!post) return res.status(404).json({ message: 'Post not found' });

        deleteImageIfExists(post.imageUrl);
        await NewsPost.deleteOne({ _id: post._id });

        return res.json({ success: true });
    } catch (error) {
        console.error('[News] Failed to delete post:', error);
        return res.status(500).json({ message: 'Failed to delete post' });
    }
});

export default router;
