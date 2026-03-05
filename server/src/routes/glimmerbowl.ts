import express from 'express';
import { IGlimmerbowlResponse } from '@cfwk/shared';
import { GlimmerbowlCache } from '../managers/GlimmerbowlCache';

const router = express.Router();

function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: 'Not authenticated' });
}

router.use(isAuthenticated);

router.get('/', async (req, res) => {
    try {
        const userId = (req.user as any).id;
        const { entries, unlocked } = await GlimmerbowlCache.getInstance().getState(userId);

        const response: IGlimmerbowlResponse = {
            entries,
            unlocked
        };
        res.json(response);
    } catch (err) {
        console.error('[Glimmerbowl] Error fetching glimmerbowl:', err);
        if ((err as Error).message === 'User not found') {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;