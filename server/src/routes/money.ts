import express from 'express';
import User from '../models/User';
import { DEFAULT_PLAYER_MONEY_STATE, IPlayerMoneyState } from '@cfwk/shared';

const router = express.Router();

function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: 'Not authenticated' });
}

router.use(isAuthenticated);

router.get('/', async (req, res) => {
    try {
        const user = await User.findById((req.user as any).id).select('money');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const moneyValue = Number((user as any).money);
        const moneyState: IPlayerMoneyState = {
            money: Number.isFinite(moneyValue)
                ? Math.max(0, Math.floor(moneyValue))
                : DEFAULT_PLAYER_MONEY_STATE.money
        };

        res.json(moneyState);
    } catch (err) {
        console.error('[Money] Error fetching player money:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;
