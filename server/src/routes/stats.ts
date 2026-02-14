import express from 'express';
import { IPlayerStatsResponse } from '@cfwk/shared';
import { PlayerStatsCache } from '../managers/PlayerStatsCache';

const router = express.Router();

function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: 'Not authenticated' });
}

router.use(isAuthenticated);

router.get('/', async (req, res) => {
    try {
        const userId = (req.user as any).id;
        const stats = await PlayerStatsCache.getInstance().getPlayerStats(userId);
        const ranks = await PlayerStatsCache.getInstance().getRanksForStats(stats, 999);

        const response: IPlayerStatsResponse = {
            stats,
            ranks
        };

        res.json(response);
    } catch (err) {
        console.error('[Stats] Error fetching player stats:', err);
        if ((err as Error).message === 'User not found') {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;
