import express from 'express';
import User from '../models/User';
import { IInventoryResponse } from '@cfwk/shared';

const router = express.Router();

function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: 'Not authenticated' });
}

router.use(isAuthenticated);

router.get('/', async (req, res) => {
    try {
        const userId = (req.user as any).id;
        const user = await User.findById(userId).select('inventory');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const response: IInventoryResponse = {
            items: user.inventory || []
        };
        res.json(response);
    } catch (err) {
        console.error('[Inventory] Error fetching inventory:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;
