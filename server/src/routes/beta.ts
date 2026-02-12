import express from 'express';
import BetaCampaign from '../models/BetaCampaign';
import BetaClaim from '../models/BetaClaim';
import User from '../models/User';

const router = express.Router();

function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: 'Not authenticated' });
}

router.use(isAuthenticated);

router.post('/redeem', async (req, res) => {
    try {
        const userId = (req.user as any).id;
        const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';

        if (!/^[0-9]{8}$/.test(code)) {
            return res.status(400).json({ message: 'Invalid code format' });
        }

        const now = new Date();
        const campaign = await BetaCampaign.findOne({ active: true, endsAt: { $gt: now } });
        if (!campaign) {
            return res.status(400).json({ message: 'Code not found/expired' });
        }

        const claim = await BetaClaim.findOne({ code, campaignId: campaign._id });
        if (!claim) {
            return res.status(404).json({ message: 'Code not found/expired' });
        }

        if (claim.expiresAt.getTime() <= now.getTime()) {
            return res.status(400).json({ message: 'Code not found/expired' });
        }

        if (claim.redeemedByUserId && claim.redeemedByUserId.toString() !== userId) {
            return res.status(409).json({ message: 'Code already redeemed' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        claim.redeemedAt = claim.redeemedAt || now;
        claim.redeemedByUserId = claim.redeemedByUserId || user._id;
        await claim.save();

        user.betaAccessUntil = campaign.endsAt;
        await user.save();

        res.json({
            message: 'Beta access granted',
            betaAccessUntil: campaign.endsAt
        });
    } catch (e) {
        console.error('[Beta] Redeem error:', e);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;
