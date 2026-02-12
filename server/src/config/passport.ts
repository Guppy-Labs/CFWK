import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as DiscordStrategy } from 'passport-discord';
import User, { IUser } from '../models/User';
import { ALLOWED_EMAILS } from './access';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_BOT_GUILD_ID = process.env.DISCORD_BOT_GUILD_ID || '';

async function addUserToDiscordGuild(discordId: string, accessToken: string) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_BOT_GUILD_ID) return;
    if (!accessToken) return;

    try {
        const response = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_BOT_GUILD_ID}/members/${discordId}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ access_token: accessToken })
        });

        if (!response.ok) {
            const body = await response.text();
            console.warn('[Discord] Failed to add member to guild', response.status, body);
        }
    } catch (err) {
        console.warn('[Discord] Guild join error', err);
    }
}

export default function initPassport() {
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Google Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback",
        passReqToCallback: true
    }, async (req: any, accessToken, refreshToken, profile, done) => {
        try {
            // check if this is a linking action (user is logged in)
            if (req.user) {
                const user = await User.findById(req.user.id);
                if (!user) return done(new Error("User not found"), undefined);

                // check collision
                const existing = await User.findOne({ googleId: profile.id });
                if (existing) {
                     if (existing.id === user.id) return done(null, user); // already linked to self
                     return done(null, false, { message: 'already_linked' });
                }

                user.googleId = profile.id;
                await user.save();
                return done(null, user);
            }

            const email = profile.emails?.[0].value;
            if (!email) return done(new Error("No email found from Google"), undefined);

            let user = await User.findOne({ googleId: profile.id });
            if (user) return done(null, user);

            user = await User.findOne({ email });
            if (user) {
                return done(null, false, { message: 'provider_mismatch' });
            }

            const perms = ['meta.preregister'];
            if (ALLOWED_EMAILS.includes(email)) {
                perms.push('access.game', 'access.maps');
            }

            const newUser = new User({
                email,
                googleId: profile.id,
                profilePic: profile.photos?.[0]?.value,
                permissions: perms,
                isVerified: true
            });
            await newUser.save();
            done(null, newUser);

        } catch (err) {
             done(err as Error, undefined);
        }
    }));
}

// discord Strategy
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
    passport.use(new DiscordStrategy({
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: process.env.DISCORD_CALLBACK_URL || "/api/auth/discord/callback",
        scope: ['identify', 'email', 'guilds.join'],
        passReqToCallback: true
    }, async (req: any, accessToken, refreshToken, profile, done) => {
        try {
            // check if this is a linking action (user is logged in)
            if (req.user) {
                const user = await User.findById(req.user.id);
                if (!user) return done(new Error("User not found"), undefined);

                 // check collision
                const existing = await User.findOne({ discordId: profile.id });
                if (existing) {
                     if (existing.id === user.id) return done(null, user); // already linked to self
                     return done(null, false, { message: 'already_linked' });
                }

                user.discordId = profile.id;
                await user.save();
                await addUserToDiscordGuild(profile.id, accessToken);
                return done(null, user);
            }

            const email = profile.email;
            if (!email) return done(new Error("No email found from Discord"), undefined);

            let user = await User.findOne({ discordId: profile.id });
            if (user) {
                await addUserToDiscordGuild(profile.id, accessToken);
                return done(null, user);
            }

            user = await User.findOne({ email });
            if (user) {
                return done(null, false, { message: 'provider_mismatch' });
            }

            const perms = ['meta.preregister'];
            if (ALLOWED_EMAILS.includes(email)) {
                perms.push('access.game', 'access.maps');
            }

            let profilePic = undefined;
            if (profile.avatar) {
                const format = profile.avatar.startsWith('a_') ? 'gif' : 'png';
                profilePic = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`;
            }

            const newUser = new User({
                email,
                discordId: profile.id,
                profilePic,
                permissions: perms,
                isVerified: true
            });
            await newUser.save();
            await addUserToDiscordGuild(profile.id, accessToken);
            done(null, newUser);
        } catch (err) {
            done(err as Error, undefined);
        }
    }));
}
}
