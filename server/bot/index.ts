import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import {
    Client,
    GatewayIntentBits,
    Partials,
    REST,
    Routes,
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Guild,
    GuildMember,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import BetaCampaign from '../src/models/BetaCampaign';
import BetaClaim from '../src/models/BetaClaim';
import User from '../src/models/User';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const BOT_CLIENT_ID = process.env.DISCORD_BOT_CLIENT_ID || '';
const BOT_GUILD_ID = process.env.DISCORD_BOT_GUILD_ID || '';
const BOT_MASTER_ID = process.env.DISCORD_BOT_MASTER_ID || '';
const MONGO_URI = process.env.MONGO_URI || '';

if (!BOT_TOKEN || !BOT_CLIENT_ID || !BOT_GUILD_ID || !BOT_MASTER_ID) {
    console.error('[BetaBot] Missing Discord bot configuration in .env');
    process.exit(1);
}

if (!MONGO_URI) {
    console.error('[BetaBot] MONGO_URI not set');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});

const GAME_URL = 'https://dev.cutefishwithknives.com/game';
const LINK_DISCORD_URL = 'https://dev.cutefishwithknives.com/api/account/link/discord';
const DIRECT_SYNC_INTERVAL_MS = 15000;
const warnedTargetCacheCampaigns = new Set<string>();

const commandData = new SlashCommandBuilder()
    .setName('beta')
    .setDescription('Claim a beta code')
    .addSubcommand((sub) =>
        sub
            .setName('join')
            .setDescription('Claim a beta code')
    )
    .addSubcommand((sub) =>
        sub
            .setName('update')
            .setDescription('Refresh your beta access if you are eligible')
    );

const adminCommandData = new SlashCommandBuilder()
    .setName('beta-admin')
    .setDescription('Beta campaign admin tools')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
        sub
            .setName('start')
            .setDescription('Start a beta campaign')
            .addStringOption((opt) =>
                opt
                    .setName('duration')
                    .setDescription('Duration like 1h, 4d2h, 30m10s')
                    .setRequired(true)
            )
            .addRoleOption((opt) =>
                opt
                    .setName('role1')
                    .setDescription('Role allowed to claim')
                    .setRequired(false)
            )
            .addRoleOption((opt) =>
                opt
                    .setName('role2')
                    .setDescription('Role allowed to claim')
                    .setRequired(false)
            )
            .addRoleOption((opt) =>
                opt
                    .setName('role3')
                    .setDescription('Role allowed to claim')
                    .setRequired(false)
            )
            .addUserOption((opt) =>
                opt
                    .setName('user1')
                    .setDescription('User allowed to claim')
                    .setRequired(false)
            )
            .addUserOption((opt) =>
                opt
                    .setName('user2')
                    .setDescription('User allowed to claim')
                    .setRequired(false)
            )
            .addUserOption((opt) =>
                opt
                    .setName('user3')
                    .setDescription('User allowed to claim')
                    .setRequired(false)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('refresh')
            .setDescription('Refresh campaign targets from roles once')
    )
    .addSubcommand((sub) =>
        sub
            .setName('add')
            .setDescription('Add users to the current campaign target list')
            .addUserOption((opt) =>
                opt
                    .setName('user1')
                    .setDescription('User to add')
                    .setRequired(false)
            )
            .addUserOption((opt) =>
                opt
                    .setName('user2')
                    .setDescription('User to add')
                    .setRequired(false)
            )
            .addUserOption((opt) =>
                opt
                    .setName('user3')
                    .setDescription('User to add')
                    .setRequired(false)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('end')
            .setDescription('End the active beta campaign')
    )
    .addSubcommand((sub) =>
        sub
            .setName('codes')
            .setDescription('Generate manual beta codes')
            .addIntegerOption((opt) =>
                opt
                    .setName('count')
                    .setDescription('How many codes to generate (max 25)')
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(25)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName('direct')
            .setDescription('Grant beta access to eligible users with linked Discord')
    )
    .addSubcommand((sub) =>
        sub
            .setName('direct-user')
            .setDescription('Grant beta access to a specific Discord user')
            .addUserOption((opt) =>
                opt
                    .setName('user')
                    .setDescription('User to grant access to')
                    .setRequired(true)
            )
    );

function parseDurationToMs(input: string): number {
    const pattern = /(\d+)\s*([dhms])/gi;
    let match: RegExpExecArray | null;
    let totalMs = 0;

    while ((match = pattern.exec(input)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        if (!Number.isFinite(value) || value <= 0) continue;
        if (unit === 'd') totalMs += value * 24 * 60 * 60 * 1000;
        if (unit === 'h') totalMs += value * 60 * 60 * 1000;
        if (unit === 'm') totalMs += value * 60 * 1000;
        if (unit === 's') totalMs += value * 1000;
    }

    return totalMs;
}

async function ensureCommands() {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    await rest.put(Routes.applicationGuildCommands(BOT_CLIENT_ID, BOT_GUILD_ID), {
        body: [commandData.toJSON(), adminCommandData.toJSON()]
    });
}

function isMaster(interaction: ChatInputCommandInteraction): boolean {
    return interaction.user.id === BOT_MASTER_ID;
}

async function generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = Math.floor(10000000 + Math.random() * 90000000).toString();
        const existing = await BetaClaim.findOne({ code }).lean();
        if (!existing) return code;
    }
    throw new Error('Failed to generate unique code');
}

function buildLinkedEmbed(endsAt: Date) {
    const endTs = Math.floor(endsAt.getTime() / 1000);
    const embed = new EmbedBuilder()
        .setTitle('Cute Fish With Knives Beta Access')
        .setDescription(`You can now join the beta session. Access ends at <t:${endTs}:f>.`)
        .setColor(0x66ccff);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Play Now')
            .setStyle(ButtonStyle.Link)
            .setURL(GAME_URL)
    );

    return { embeds: [embed], components: [row] };
}

function buildUnlinkedEmbed() {
    const embed = new EmbedBuilder()
        .setTitle('Cute Fish With Knives Beta Invite')
        .setDescription('You are invited to the beta, but your Discord is not linked to a CFWK account yet.')
        .setColor(0x66ccff);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Link Discord')
            .setStyle(ButtonStyle.Link)
            .setURL(LINK_DISCORD_URL)
    );

    return { embeds: [embed], components: [row] };
}

function buildEndedEmbed(endedAt: Date) {
    const endTs = Math.floor(endedAt.getTime() / 1000);
    const embed = new EmbedBuilder()
        .setTitle('Beta Campaign Ended')
        .setDescription(`This beta test ended at <t:${endTs}:f>. Thanks for playing!`)
        .setColor(0xff6b6b);

    return { embeds: [embed] };
}

function mergeUnique(existing: string[], additions: string[]) {
    return Array.from(new Set([...(existing || []), ...(additions || [])]));
}

function getCampaignTargetIds(campaign: any): string[] {
    if (Array.isArray(campaign.targetIds) && campaign.targetIds.length > 0) {
        return campaign.targetIds as string[];
    }
    return Array.from(new Set((campaign.accessUsers || []) as string[]));
}

async function refreshCampaignTargets(campaign: any, guild: Guild) {
    const accessUsers = (campaign.accessUsers || []) as string[];
    const accessRoles = (campaign.accessRoles || []) as string[];
    const targetIds = new Set<string>(accessUsers);

    if (accessRoles.length > 0) {
        await guild.members.fetch();
        accessRoles.forEach((roleId: string) => {
            const role = guild.roles.cache.get(roleId);
            if (!role) return;
            role.members.forEach((member) => targetIds.add(member.id));
        });
    }

    campaign.targetIds = Array.from(targetIds);
    campaign.targetsRefreshedAt = new Date();
    await campaign.save();
    return campaign.targetIds as string[];
}

async function syncDirectInvites(campaign: any) {
    const accessRoles = (campaign.accessRoles || []) as string[];
    const targetIds = new Set<string>(getCampaignTargetIds(campaign));

    if (accessRoles.length > 0 && targetIds.size === 0) {
        const campaignId = String(campaign._id);
        if (!warnedTargetCacheCampaigns.has(campaignId)) {
            warnedTargetCacheCampaigns.add(campaignId);
            console.warn('[BetaBot] Campaign targets not refreshed yet. Run /beta-admin refresh to include role members.');
        }
    }

    let granted = 0;
    let needsLink = 0;
    let dmFailed = 0;

    for (const discordId of targetIds) {
        const user = await User.findOne({ discordId: String(discordId) });
        if (user) {
            const needsGrant = !user.betaAccessUntil || user.betaAccessUntil.getTime() < campaign.endsAt.getTime();
            if (!needsGrant) continue;
            user.betaAccessUntil = campaign.endsAt;
            await user.save();
            granted += 1;
            try {
                const dmTarget = await client.users.fetch(discordId);
                await dmTarget.send(buildLinkedEmbed(campaign.endsAt));
            } catch {
                dmFailed += 1;
            }
        } else {
            needsLink += 1;
        }
    }

    return { granted, needsLink, dmFailed };
}

client.once('clientReady', async () => {
    console.log(`[BetaBot] Logged in as ${client.user?.tag}`);
    setInterval(async () => {
        const campaign = await BetaCampaign.findOne({ active: true, endsAt: { $gt: new Date() } });
        if (!campaign) return;
        await syncDirectInvites(campaign);
    }, DIRECT_SYNC_INTERVAL_MS);

    setInterval(async () => {
        const endedCampaigns = await BetaCampaign.find({
            active: false,
            endedAt: { $ne: null },
            endNotified: { $ne: true }
        });

        for (const campaign of endedCampaigns) {
            try {
                const targetIds = new Set<string>(getCampaignTargetIds(campaign));
                for (const discordId of targetIds) {
                    try {
                        const dmTarget = await client.users.fetch(discordId);
                        await dmTarget.send(buildEndedEmbed(campaign.endedAt || new Date()));
                    } catch {
                        // Ignore DM failures
                    }
                }
            } finally {
                campaign.endNotified = true;
                await campaign.save();
            }
        }
    }, DIRECT_SYNC_INTERVAL_MS);
});

client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== BOT_GUILD_ID) return;
    try {
        const embed = new EmbedBuilder()
            .setTitle('Thanks for linking your Discord')
            .setDescription('You are all set. If you have beta access, you will get a play link shortly.')
            .setColor(0x66ccff);
        await member.send({ embeds: [embed] });
    } catch {
        // Ignore DM failures
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'beta-admin') {
        const subcommand = interaction.options.getSubcommand();

        if (!isMaster(interaction)) {
            await interaction.reply({ content: 'Only the master user can run this command.', ephemeral: true });
            return;
        }

        if (subcommand === 'start') {
            if (!interaction.inGuild() || !interaction.guild) {
                await interaction.reply({ content: 'This command must be run in the server.', ephemeral: true });
                return;
            }
            const durationInput = interaction.options.getString('duration', true);
            const durationMs = parseDurationToMs(durationInput);
            if (durationMs <= 0) {
                await interaction.reply({ content: 'Invalid duration format.', ephemeral: true });
                return;
            }

            const active = await BetaCampaign.findOne({ active: true });
            if (active) {
                await interaction.reply({ content: 'A beta campaign is already active.', ephemeral: true });
                return;
            }

            const accessRoles = [
                interaction.options.getRole('role1'),
                interaction.options.getRole('role2'),
                interaction.options.getRole('role3')
            ].filter(Boolean).map((role) => role!.id);

            const accessUsers = [
                interaction.options.getUser('user1'),
                interaction.options.getUser('user2'),
                interaction.options.getUser('user3')
            ].filter(Boolean).map((user) => user!.id);

            const now = new Date();
            const endsAt = new Date(now.getTime() + durationMs);

            const campaign = await BetaCampaign.create({
                active: true,
                startedAt: now,
                endsAt,
                durationMs,
                accessRoles: Array.from(new Set(accessRoles)),
                accessUsers: Array.from(new Set(accessUsers)),
                createdBy: interaction.user.id,
                endProcessed: false
            });

            try {
                await refreshCampaignTargets(campaign, interaction.guild);
            } catch (err) {
                console.warn('[BetaBot] Failed to refresh campaign targets on start.', err);
            }

            const roleLabel = accessRoles.length ? accessRoles.map((id) => `<@&${id}>`).join(', ') : 'None';
            const userLabel = accessUsers.length ? accessUsers.map((id) => `<@${id}>`).join(', ') : 'None';

            await interaction.reply({
                content: `Beta campaign started. Ends at <t:${Math.floor(endsAt.getTime() / 1000)}:f>.\nRoles: ${roleLabel}\nUsers: ${userLabel}`,
                ephemeral: true
            });
            return;
        }

        if (subcommand === 'refresh') {
            const campaign = await BetaCampaign.findOne({ active: true, endsAt: { $gt: new Date() } });
            if (!campaign) {
                await interaction.reply({ content: 'No active beta campaign found.', ephemeral: true });
                return;
            }
            if (!interaction.inGuild() || !interaction.guild) {
                await interaction.reply({ content: 'This command must be run in the server.', ephemeral: true });
                return;
            }

            try {
                const targetIds = await refreshCampaignTargets(campaign, interaction.guild);
                await interaction.reply({ content: `Campaign targets refreshed. Total targets: ${targetIds.length}.`, ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: 'Failed to refresh campaign targets.', ephemeral: true });
                console.warn('[BetaBot] Failed to refresh campaign targets.', err);
            }
            return;
        }

        if (subcommand === 'add') {
            const campaign = await BetaCampaign.findOne({ active: true, endsAt: { $gt: new Date() } });
            if (!campaign) {
                await interaction.reply({ content: 'No active beta campaign found.', ephemeral: true });
                return;
            }

            const additions = [
                interaction.options.getUser('user1'),
                interaction.options.getUser('user2'),
                interaction.options.getUser('user3')
            ].filter(Boolean).map((user) => user!.id);

            if (additions.length === 0) {
                await interaction.reply({ content: 'Provide at least one user to add.', ephemeral: true });
                return;
            }

            campaign.accessUsers = mergeUnique(campaign.accessUsers || [], additions);
            if (Array.isArray(campaign.targetIds)) {
                campaign.targetIds = mergeUnique(campaign.targetIds, additions);
            }
            await campaign.save();

            await interaction.reply({ content: `Added ${additions.length} user(s) to the campaign targets.`, ephemeral: true });
            return;
        }

        if (subcommand === 'end') {
            const campaign = await BetaCampaign.findOne({ active: true });
            if (!campaign) {
                await interaction.reply({ content: 'No active beta campaign found.', ephemeral: true });
                return;
            }

            campaign.active = false;
            campaign.endedAt = new Date();
            campaign.endReason = 'manual';
            campaign.endProcessed = false;
            await campaign.save();

            await interaction.reply({ content: 'Beta campaign ended.', ephemeral: true });
            return;
        }

        if (subcommand === 'codes') {
            const campaign = await BetaCampaign.findOne({ active: true, endsAt: { $gt: new Date() } });
            if (!campaign) {
                await interaction.reply({ content: 'No active beta campaign found.', ephemeral: true });
                return;
            }

            const count = interaction.options.getInteger('count') || 5;
            const codes: string[] = [];
            for (let i = 0; i < count; i += 1) {
                const code = await generateUniqueCode();
                await BetaClaim.create({
                    code,
                    campaignId: campaign._id,
                    discordUserId: `manual:${interaction.user.id}`,
                    issuedAt: new Date(),
                    expiresAt: campaign.endsAt
                });
                codes.push(code);
            }

            await interaction.reply({
                content: `Generated ${codes.length} codes:\n${codes.map((code) => `\`${code}\``).join(' ')}`,
                ephemeral: true
            });
            return;
        }

        if (subcommand === 'direct') {
            const campaign = await BetaCampaign.findOne({ active: true, endsAt: { $gt: new Date() } });
            if (!campaign) {
                await interaction.reply({ content: 'No active beta campaign found.', ephemeral: true });
                return;
            }

            if (!interaction.inGuild() || !interaction.guild) {
                await interaction.reply({ content: 'This command must be run in the server.', ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: true });
            let granted = 0;
            let needsLink = 0;
            let dmFailed = 0;

            const targetIds = new Set<string>(getCampaignTargetIds(campaign));
            for (const discordId of targetIds) {
                const user = await User.findOne({ discordId: String(discordId) });
                if (user) {
                    user.betaAccessUntil = campaign.endsAt;
                    await user.save();
                    granted += 1;
                    try {
                        const dmTarget = await client.users.fetch(discordId);
                        await dmTarget.send(buildLinkedEmbed(campaign.endsAt));
                    } catch {
                        dmFailed += 1;
                    }
                } else {
                    needsLink += 1;
                    try {
                        const dmTarget = await client.users.fetch(discordId);
                        await dmTarget.send(buildUnlinkedEmbed());
                    } catch {
                        dmFailed += 1;
                    }
                }
            }

            await interaction.editReply({
                content: `Direct invite finished. Granted: ${granted}. Needs link: ${needsLink}. DM failures: ${dmFailed}.`,
            });
            return;
        }

        if (subcommand === 'direct-user') {
            const campaign = await BetaCampaign.findOne({ active: true, endsAt: { $gt: new Date() } });
            if (!campaign) {
                await interaction.reply({ content: 'No active beta campaign found.', ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: true });

            const targetUser = interaction.options.getUser('user', true);
            const discordId = targetUser.id;
            const user = await User.findOne({ discordId: String(discordId) });

            let granted = 0;
            let needsLink = 0;
            let dmFailed = 0;

            if (user) {
                user.betaAccessUntil = campaign.endsAt;
                await user.save();
                granted = 1;
                try {
                    const dmTarget = await client.users.fetch(discordId);
                    await dmTarget.send(buildLinkedEmbed(campaign.endsAt));
                } catch {
                    dmFailed = 1;
                }
            } else {
                needsLink = 1;
                try {
                    const dmTarget = await client.users.fetch(discordId);
                    await dmTarget.send(buildUnlinkedEmbed());
                } catch {
                    dmFailed = 1;
                }
            }

            await interaction.editReply({
                content: `Direct user invite finished. Granted: ${granted}. Needs link: ${needsLink}. DM failures: ${dmFailed}.`,
            });
            return;
        }
    }

    if (interaction.commandName !== 'beta') return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'join' || subcommand === 'update') {
        const campaign = await BetaCampaign.findOne({ active: true, endsAt: { $gt: new Date() } });
        if (!campaign) {
            await interaction.reply({ content: 'No active beta campaign.', ephemeral: true });
            return;
        }

        const member = interaction.inGuild()
            ? await interaction.guild?.members.fetch(interaction.user.id)
            : null;
        const accessUsers = campaign.accessUsers || [];
        const accessRoles = campaign.accessRoles || [];

        let isAllowed = accessUsers.includes(interaction.user.id);
        if (!isAllowed && member instanceof GuildMember) {
            const roleIds = member.roles.cache.map((role) => role.id);
            isAllowed = roleIds.some((id) => accessRoles.includes(id));
        }

        if (!isAllowed) {
            await interaction.reply({ content: 'You do not have access to this beta campaign.', ephemeral: true });
            return;
        }

        if (subcommand === 'update') {
            const user = await User.findOne({ discordId: interaction.user.id });
            if (!user) {
                try {
                    await interaction.user.send(buildUnlinkedEmbed());
                    await interaction.reply({ content: 'You need to link your Discord first. Check your DMs.', ephemeral: true });
                } catch {
                    await interaction.reply({ content: 'You need to link your Discord before beta access can be granted.', ephemeral: true });
                }
                return;
            }

            const needsGrant = !user.betaAccessUntil || user.betaAccessUntil.getTime() < campaign.endsAt.getTime();
            if (!needsGrant) {
                await interaction.reply({ content: 'Your beta access is already up to date.', ephemeral: true });
                return;
            }

            user.betaAccessUntil = campaign.endsAt;
            await user.save();

            try {
                await interaction.user.send(buildLinkedEmbed(campaign.endsAt));
            } catch {
                // Ignore DM failures
            }

            await interaction.reply({ content: 'Your beta access has been refreshed.', ephemeral: true });
            return;
        }

        const existingClaim = await BetaClaim.findOne({ campaignId: campaign._id, discordUserId: interaction.user.id });
        if (existingClaim) {
            await interaction.reply({ content: 'You already claimed a beta code for this campaign.', ephemeral: true });
            return;
        }

        const code = await generateUniqueCode();
        const claim = await BetaClaim.create({
            code,
            campaignId: campaign._id,
            discordUserId: interaction.user.id,
            issuedAt: new Date(),
            expiresAt: campaign.endsAt
        });

        const endTs = Math.floor(campaign.endsAt.getTime() / 1000);
        try {
            await interaction.user.send({
                content: `**Cute Fish With Knives Beta Access**\n\n**Your code:** \`${claim.code}\`\n**Expires:** <t:${endTs}:f>\n\nUse it on your account page to unlock beta play.`
            });
        } catch (err) {
            await interaction.reply({ content: 'Unable to send a DM. Please enable direct messages.', ephemeral: true });
            return;
        }

        await interaction.reply({ content: 'Check your DMs for your beta code.', ephemeral: true });
    }
});

(async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('[BetaBot] Connected to MongoDB');
        await ensureCommands();
        await client.login(BOT_TOKEN);
    } catch (err) {
        console.error('[BetaBot] Startup error:', err);
        process.exit(1);
    }
})();
