import express from 'express';
import passport from 'passport';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import User from '../models/User';
import BannedIP from '../models/BannedIP';
import { ALLOWED_EMAILS } from '../config/access';
import { sendEmail } from '../utils/email';
import { getUsernameValidationError, normalizeUsername } from '../utils/username';

const router = express.Router();

// --- Email / Password ---

router.post('/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Missing fields' });

        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ message: 'User already exists' });

        if (typeof username === 'string' && username.trim().length > 0) {
            const usernameError = getUsernameValidationError(username);
            if (usernameError) return res.status(400).json({ message: usernameError });

            const normalizedUsername = normalizeUsername(username);
            if (normalizedUsername.toLowerCase() === 'system') {
                return res.status(400).json({ message: 'Username taken' });
            }
            const existingUsername = await User.findOne({ username: normalizedUsername });
            if (existingUsername) return res.status(400).json({ message: 'Username taken' });
        }

        // Determine permissions
        const perms = ['meta.preregister'];
        if (ALLOWED_EMAILS.includes(email)) {
            perms.push('access.game', 'access.maps');
        }

        const verifyToken = crypto.randomBytes(32).toString('hex');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = new User({ 
            email, 
            password: hashedPassword,
            username: typeof username === 'string' && username.trim().length > 0 ? normalizeUsername(username) : undefined, 
            permissions: perms,
            isVerified: false,
            verificationToken: verifyToken
        });
        await newUser.save();

        const verifyUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/verify?token=${verifyToken}`;
        
        try {
            await sendEmail({
                email,
                subject: 'Verify Your Account - CFWK',
                message: 'Welcome to Cute Fish With Knives! Please verify your email address to activate your account and start playing.',
                actionUrl: verifyUrl,
                actionText: 'Verify Account'
            });
        } catch (e) {
            console.error('Email send error:', e);
        }

        res.json({ message: 'Registration successful! Please check your email to verify.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const targetEmail = email || req.body.username;
        
        if (!targetEmail || !password) return res.status(400).json({ message: 'Missing credentials' });

        const user = await User.findOne({ email: targetEmail });
        if (!user || !user.password) return res.status(401).json({ message: 'Invalid credentials' });
        
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ message: 'Invalid credentials' });

        if (!user.isVerified) {
             return res.status(403).json({ message: 'Please verify your email address before logging in.', code: 'not_verified' });
        }

        req.login(user, (err) => {
            if (err) return next(err);
            return res.json({ user });
        });
    } catch (e) {
        next(e);
    }
});

router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ message: 'Missing token' });

        const user = await User.findOne({ verificationToken: token });
        if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();

        // Auto login?
        req.login(user, (err) => {
            if (err) return res.status(200).json({ message: 'Verified', user });
            return res.json({ message: 'Verified', user });
        });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        
        if (user) {
            // Cooldown check (2 minutes)
            if (user.lastPasswordResetRequest) {
                const diff = Date.now() - new Date(user.lastPasswordResetRequest).getTime();
                if (diff < 2 * 60 * 1000) {
                     return res.status(429).json({ message: 'Please wait a few minutes before trying again.' });
                }
            }

            user.lastPasswordResetRequest = new Date();

            if (user.password) {
                // Has password - Send reset link
                const token = crypto.randomBytes(32).toString('hex');
                user.passwordResetToken = token;
                user.passwordResetExpires = new Date(Date.now() + 3600000); // 1 hour
                await user.save();

                const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset?token=${token}`;

                await sendEmail({
                    email,
                    subject: 'Reset Password - CFWK',
                    message: 'You requested a password reset. If this was you, click the button below to set a new password. The link expires in 1 hour.',
                    actionUrl: resetUrl,
                    actionText: 'Reset Password'
                });
            } else {
                // No password - OAuth account
                await user.save(); // Save cooldown

                let method = 'a social provider';
                if (user.googleId) method = 'Google';
                else if (user.discordId) method = 'Discord';

                await sendEmail({
                    email,
                    subject: 'Account Sign-in Method - CFWK',
                    message: `You requested a password reset, but this account is set up to sign in with ${method}. You do not have a separate password. Please log in using ${method}.`,
                    actionUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/login`,
                    actionText: 'Go to Login'
                });
            }
        }
        
        // Always return success to prevent enumeration
        res.json({ message: 'If that email exists, we sent you an email.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        const user = await User.findOne({ 
            passwordResetToken: token, 
            passwordResetExpires: { $gt: new Date() } 
        });

        if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

        user.password = await bcrypt.hash(password, 10);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();

        res.json({ message: 'Password updated' });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});

// --- Google ---
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/link/google', (req, res, next) => {
    // Ensure logged in
    if (!req.isAuthenticated()) return res.redirect('/login');
    next();
}, passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/link/discord', (req, res, next) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    next();
}, passport.authenticate('discord'));


router.get('/google/callback', (req, res, next) => {
    passport.authenticate('google', (err: any, user: any, info: any) => {
        if (err) return next(err);
        if (!user) {
            let code = 'google_failed';
            if (info && info.message) {
                 if (info.message === 'provider_mismatch') code = 'provider_mismatch';
                 else if (info.message === 'already_linked') code = 'already_linked';
                 else if (info.message.includes('not allowed')) code = 'restricted';
            }
            if (info && info.message === 'already_linked') {
                 return res.redirect(`${process.env.CLIENT_URL || ''}/account?error=already_linked`);
            }
            return res.redirect(`${process.env.CLIENT_URL || ''}/login?error=${code}`);
        }
        req.login(user, (err) => {
            if (err) return next(err);
            
              if (!user.username) {
                  return res.redirect(`${process.env.CLIENT_URL || ''}/onboarding`);
              }
            
              res.redirect(`${process.env.CLIENT_URL || ''}/login?oauth=google`);
        });
    })(req, res, next);
});

// --- Discord ---
router.get('/discord', passport.authenticate('discord'));

router.get('/discord/callback', (req, res, next) => {
    passport.authenticate('discord', (err: any, user: any, info: any) => {
        if (err) return next(err);
        if (!user) {
            let code = 'discord_failed';
             if (info && info.message) {
                 if (info.message === 'provider_mismatch') code = 'provider_mismatch';
                 else if (info.message === 'already_linked') code = 'already_linked';
                 else if (info.message.includes('not allowed')) code = 'restricted';
            }
            if (info && info.message === 'already_linked') {
                 return res.redirect(`${process.env.CLIENT_URL || ''}/account?error=already_linked`);
            }
            return res.redirect(`${process.env.CLIENT_URL || ''}/login?error=${code}`);
        }
        req.login(user, (err) => {
            if (err) return next(err);

              if (!user.username) {
                  return res.redirect(`${process.env.CLIENT_URL || ''}/onboarding`);
              }

              res.redirect(`${process.env.CLIENT_URL || ''}/login?oauth=discord`);
        });
    })(req, res, next);
});



router.post('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.json({ message: 'Logged out' });
    });
});

router.post('/set-username', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Not authenticated' });
    const user = req.user as any;
    const { username } = req.body;

    if (!username || typeof username !== 'string') return res.status(400).json({ message: 'Username required' });
    const usernameError = getUsernameValidationError(username);
    if (usernameError) return res.status(400).json({ message: usernameError });
    const normalizedUsername = normalizeUsername(username);
    if (normalizedUsername.toLowerCase() === 'system') {
        return res.status(400).json({ message: 'Username taken' });
    }
    
    // Check constraints
    // 1. Unique
    const existing = await User.findOne({ username: normalizedUsername });
    if (existing && existing.id !== user.id) return res.status(400).json({ message: 'Username taken' });

    // 2. 14 Days
    if (user.lastUsernameChange) {
        const diffTime = Math.abs(new Date().getTime() - new Date(user.lastUsernameChange).getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        if (diffDays < 14) {
             return res.status(400).json({ message: `Cannot change username yet. Try again in ${14 - diffDays} days.` });
        }
    }

    try {
        const userDoc = await User.findById(user.id);
        if(!userDoc) return res.status(404).json({ message: 'User not found' });
        
        userDoc.username = normalizedUsername;
        userDoc.lastUsernameChange = new Date();
        await userDoc.save();
        
        res.json({ user: userDoc });
    } catch(err) {
        res.status(500).json({ message: 'Error updating username' });
    }
});

router.post('/manual-login', async (req, res) => {
     const { email, password } = req.body;
     if (!email || !password) return res.status(400).json({ message: 'Missing fields' });

     try {
         const user = await User.findOne({ email });
         if (!user || !user.password) return res.status(401).json({ message: 'Invalid credentials' });

         const match = await bcrypt.compare(password, user.password);
         if (!match) return res.status(401).json({ message: 'Invalid credentials' });

         if (!user.isVerified) {
             return res.status(403).json({ message: 'User not verified', code: 'not_verified' });
         }

         req.login(user, (err) => {
             if (err) return res.status(500).json({ message: 'Login error' });
             res.json({ user });
         });
     } catch (err) {
         res.status(500).json({ message: 'Server error' });
     }
});

router.post('/unlink', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Not authenticated' });
    const user = req.user as any;
    const { provider } = req.body; // 'google' or 'discord'

    if (!provider || !['google', 'discord'].includes(provider)) {
        return res.status(400).json({ message: 'Invalid provider' });
    }

    try {
        const userDoc = await User.findById(user.id);
        if (!userDoc) return res.status(404).json({ message: 'User not found' });

        const hasPassword = !!userDoc.password;
        const hasGoogle = !!userDoc.googleId;
        const hasDiscord = !!userDoc.discordId;
        
        let methods = 0;
        if (hasPassword) methods++;
        if (hasGoogle && provider !== 'google') methods++;
        if (hasDiscord && provider !== 'discord') methods++;

        if (methods === 0) {
            return res.status(400).json({ message: 'Cannot unlink your only login method. Set a password first.' });
        }

        // Perform unlink
        if (provider === 'google') userDoc.googleId = undefined;
        if (provider === 'discord') userDoc.discordId = undefined;

        await userDoc.save();
        res.json({ message: 'Unlinked successfully', user: userDoc });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });
        
        if (user.isVerified) {
            return res.status(400).json({ message: 'User is already verified' });
        }

        if (!user.verificationToken) {
            user.verificationToken = crypto.randomBytes(32).toString('hex');
            await user.save();
        }

        const verifyUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/verify?token=${user.verificationToken}`;
        
        await sendEmail({
            email,
            subject: 'Verify Your Account - CFWK',
            message: 'You requested a new verification link. Click the button below to activate your account.',
            actionUrl: verifyUrl,
            actionText: 'Verify Account'
        });

        res.json({ message: 'Email sent' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to send email' });
    }
});

// Endpoint to check current session
router.get('/me', async (req, res) => {
    if (req.isAuthenticated()) {
        //@ts-ignore
        const u = req.user.toObject ? req.user.toObject() : { ...req.user };
        // Indicate if they have a password safely
        //@ts-ignore
        u.hasPassword = !!req.user.password;
        delete u.password;

        const betaAccessUntil = u.betaAccessUntil ? new Date(u.betaAccessUntil) : null;
        u.hasBetaAccess = !!(betaAccessUntil && betaAccessUntil.getTime() > Date.now());
        
        // Check if user's IP is banned
        const clientIP = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() 
            || req.headers['x-real-ip']?.toString() 
            || req.socket?.remoteAddress;
        
        if (clientIP) {
            try {
                const ipBan = await BannedIP.findOne({ ip: clientIP });
                if (ipBan && ipBan.bannedUntil.getTime() > Date.now()) {
                    u.ipBannedUntil = ipBan.bannedUntil;
                }
            } catch (e) {
                console.error("Error checking IP ban:", e);
            }
        }
        
        return res.json({ user: u });
    }
    return res.status(401).json({ message: 'Not authenticated' });
});

export default router;
