import express from 'express';
import { DEFAULT_INVENTORY_SLOTS, IInventoryResponse } from '@cfwk/shared';
import { InventoryCache } from '../managers/InventoryCache';

const router = express.Router();

function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: 'Not authenticated' });
}

router.use(isAuthenticated);

router.get('/', async (req, res) => {
    try {
        const userId = (req.user as any).id;
        const { items: slots, equippedRodId } = await InventoryCache.getInstance().getInventoryState(userId);

        const response: IInventoryResponse = {
            slots,
            totalSlots: DEFAULT_INVENTORY_SLOTS,
            equippedRodId
        };
        res.json(response);
    } catch (err) {
        console.error('[Inventory] Error fetching inventory:', err);
        if ((err as Error).message === 'User not found') {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;
