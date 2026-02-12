import BetaCampaign from '../models/BetaCampaign';
import User from '../models/User';
import { InstanceManager } from '../managers/InstanceManager';

const MONITOR_INTERVAL_MS = 30000;

async function markCampaignEnded(campaignId: string, reason: string) {
    await BetaCampaign.updateOne(
        { _id: campaignId, active: true },
        { $set: { active: false, endedAt: new Date(), endReason: reason, endProcessed: false } }
    );
}

async function processEndedCampaign(campaignId: string, instanceManager: InstanceManager) {
    const now = new Date();
    const users = await User.find({ betaAccessUntil: { $ne: null, $lte: now } }).select('_id').lean();
    const userIds = users.map((user) => String(user._id));
    if (userIds.length > 0) {
        await User.updateMany(
            { _id: { $in: userIds } },
            { $set: { betaAccessUntil: null } }
        );
        instanceManager.events.emit('beta_kick', {
            userIds,
            reason: 'Beta campaign ended'
        });
    }

    await BetaCampaign.updateOne({ _id: campaignId }, { $set: { endProcessed: true } });
}

export function startBetaCampaignMonitor(instanceManager: InstanceManager) {
    const tick = async () => {
        try {
            const now = new Date();

            const active = await BetaCampaign.findOne({ active: true });
            if (active && active.endsAt.getTime() <= now.getTime()) {
                await markCampaignEnded(active._id.toString(), 'expired');
            }

            const pendingEnds = await BetaCampaign.find({ active: false, endProcessed: false });
            for (const campaign of pendingEnds) {
                await processEndedCampaign(campaign._id.toString(), instanceManager);
            }
        } catch (err) {
            console.error('[Beta] Monitor error:', err);
        }
    };

    tick().catch(() => undefined);
    setInterval(tick, MONITOR_INTERVAL_MS);
}
