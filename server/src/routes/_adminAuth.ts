import express from 'express';
import User from '../models/User';

export function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    return res.status(401).json({ message: 'Not authenticated' });
}

export async function isGameAdmin(req: express.Request): Promise<boolean> {
    if (!req.isAuthenticated || !req.isAuthenticated()) return false;
    const userId = (req.user as any)?.id || (req.user as any)?._id;
    if (!userId) return false;

    const user = await User.findById(userId).select('permissions');
    return Boolean(user && Array.isArray(user.permissions) && user.permissions.includes('game.admin'));
}

export async function requireGameAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const allowed = await isGameAdmin(req);
    if (!allowed) {
        return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
}
