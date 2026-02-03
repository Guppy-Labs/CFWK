import express from 'express';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';

// Ensure env vars are loaded even if this module is imported before server bootstrap
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const router = express.Router();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
if (!stripeSecretKey) {
    console.error('[Stripe] STRIPE_SECRET_KEY is missing. Check server .env loading.');
}
const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16'
});

const getClientUrl = () => process.env.CLIENT_URL || 'http://localhost:5173';

router.get('/webhook', (_req, res) => {
    return res.json({ ok: true, message: 'Stripe webhook endpoint is live (POST only).' });
});

router.post('/create-checkout-session', async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ message: 'Not authenticated' });
        }

        const priceId = process.env.STRIPE_PRICE_ID;
        if (!priceId) {
            return res.status(500).json({ message: 'Stripe price not configured' });
        }

        const userId = (req.user as any).id || (req.user as any)._id;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Create or reuse Stripe customer
        let customerId = user.stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: { userId: user.id }
            });
            customerId = customer.id;
            user.stripeCustomerId = customerId;
            await user.save();
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            line_items: [
                { price: priceId, quantity: 1 }
            ],
            success_url: `${getClientUrl()}/upgrade/thanks`,
            cancel_url: `${getClientUrl()}/upgrade?canceled=1`,
            client_reference_id: user.id,
            metadata: {
                userId: user.id,
                tier: 'shark'
            }
        });

        return res.json({ url: session.url });
    } catch (e: any) {
        console.error('[Stripe] Checkout session error', e);
        return res.status(500).json({ message: 'Failed to create checkout session' });
    }
});

router.post('/cancel-subscription', async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ message: 'Not authenticated' });
        }

        const userId = (req.user as any).id || (req.user as any)._id;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.stripeSubscriptionId) {
            return res.status(400).json({ message: 'No active subscription found' });
        }

        const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
            cancel_at_period_end: true
        });

        user.premiumStatus = 'canceled';
        user.premiumTier = 'shark';
        if (subscription.current_period_end) {
            user.premiumCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
        }
        await user.save();

        return res.json({
            success: true,
            status: 'canceled',
            currentPeriodEnd: subscription.current_period_end
        });
    } catch (e: any) {
        console.error('[Stripe] Cancel subscription error', e);
        return res.status(500).json({ message: 'Failed to cancel subscription' });
    }
});

router.post('/resume-subscription', async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ message: 'Not authenticated' });
        }

        const userId = (req.user as any).id || (req.user as any)._id;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.stripeSubscriptionId) {
            return res.status(400).json({ message: 'No subscription found to resume' });
        }

        // Remove the cancellation by setting cancel_at_period_end to false
        const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
            cancel_at_period_end: false
        });

        user.premiumStatus = subscription.status;
        user.premiumTier = 'shark';
        if (subscription.current_period_end) {
            user.premiumCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
        }
        await user.save();

        return res.json({
            success: true,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end
        });
    } catch (e: any) {
        console.error('[Stripe] Resume subscription error', e);
        return res.status(500).json({ message: 'Failed to resume subscription' });
    }
});

export const stripeWebhookHandler = async (req: express.Request, res: express.Response) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    const sig = req.headers['stripe-signature'];

    let event: Stripe.Event;

    try {
        if (!webhookSecret) {
            return res.status(500).send('Webhook secret not configured');
        }
        event = stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret);
        console.info(`[Stripe] Webhook received: ${event.type}`);
    } catch (err: any) {
        console.error('[Stripe] Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                const userId = session.client_reference_id || session.metadata?.userId;
                if (userId) {
                    const user = await User.findById(userId);
                    if (user) {
                        const subscriptionId = session.subscription as string | null;
                        if (subscriptionId) user.stripeSubscriptionId = subscriptionId;
                        if (session.customer) user.stripeCustomerId = session.customer as string;
                        user.premiumTier = 'shark';
                        user.premiumStatus = 'active';
                        if (!user.permissions.includes('premium.shark')) {
                            user.permissions.push('premium.shark');
                        }
                        await user.save();
                    }
                }
                break;
            }
            case 'invoice.payment_succeeded': {
                const invoice = event.data.object as Stripe.Invoice;
                const customerId = invoice.customer as string;
                const user = await User.findOne({ stripeCustomerId: customerId });
                if (user) {
                    user.premiumStatus = 'active';
                    user.premiumTier = 'shark';
                    if (invoice.lines?.data?.[0]?.period?.end) {
                        user.premiumCurrentPeriodEnd = new Date(invoice.lines.data[0].period.end * 1000);
                    }
                    if (!user.permissions.includes('premium.shark')) {
                        user.permissions.push('premium.shark');
                    }
                    await user.save();
                }
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                const customerId = invoice.customer as string;
                const user = await User.findOne({ stripeCustomerId: customerId });
                if (user) {
                    user.premiumStatus = 'past_due';
                    user.permissions = user.permissions.filter(p => p !== 'premium.shark');
                    await user.save();
                }
                break;
            }
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                const customerId = subscription.customer as string;
                const user = await User.findOne({ stripeCustomerId: customerId });
                if (user) {
                    const isActive = subscription.status === 'active' || subscription.status === 'trialing';
                    
                    // Check if subscription is set to cancel at period end
                    if (subscription.cancel_at_period_end && isActive) {
                        // Subscription is active but will cancel - mark as canceled
                        user.premiumStatus = 'canceled';
                        user.premiumTier = 'shark'; // Still has access until period end
                    } else {
                        user.premiumStatus = subscription.status;
                        user.premiumTier = isActive ? 'shark' : null;
                    }
                    
                    user.stripeSubscriptionId = subscription.id;
                    if (subscription.current_period_end) {
                        user.premiumCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
                    }
                    if (isActive) {
                        if (!user.permissions.includes('premium.shark')) {
                            user.permissions.push('premium.shark');
                        }
                    } else {
                        user.permissions = user.permissions.filter(p => p !== 'premium.shark');
                    }
                    await user.save();
                }
                break;
            }
            case 'charge.dispute.created': {
                const dispute = event.data.object as Stripe.Dispute;
                const charge = await stripe.charges.retrieve(dispute.charge as string);
                const customerId = charge.customer as string | null;
                if (customerId) {
                    const user = await User.findOne({ stripeCustomerId: customerId });
                    if (user) {
                        user.premiumStatus = 'disputed';
                        user.permissions = user.permissions.filter(p => p !== 'premium.shark');
                        await user.save();
                    }
                }
                break;
            }
            default:
                break;
        }
    } catch (e) {
        console.error('[Stripe] Webhook handler error', e);
        return res.status(500).send('Webhook handler error');
    }

    res.json({ received: true });
};

export default router;
