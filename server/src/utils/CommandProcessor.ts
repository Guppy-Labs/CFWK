import User from '../models/User';
import BannedIP from '../models/BannedIP';
import { InstanceManager } from '../managers/InstanceManager';
import { InventoryCache } from '../managers/InventoryCache';
import { GlimmerbowlCache } from '../managers/GlimmerbowlCache';
import { PlayerStatsCache } from '../managers/PlayerStatsCache';
import { DEFAULT_GUIDE_TUTORIAL_STATE, DEFAULT_INVENTORY_SLOTS, DEFAULT_PLAYER_HEARTS_STATE, DEFAULT_PLAYER_STATS, DEFAULT_USER_ADVANCEMENTS, getItemDefinition } from '@cfwk/shared';
import { DEFAULT_FIRST_CONNECT_LOCATION_ID } from '../config/instance';

export type CommandExecutionResult = {
    success: boolean;
    message: string;
};

function createEmptyInventorySlots() {
    return Array.from({ length: DEFAULT_INVENTORY_SLOTS }, (_v, index) => ({ index, itemId: null, count: 0 }));
}

export class CommandProcessor {
    private static readonly failureMessagePatterns: RegExp[] = [
        /^usage:/i,
        /^unknown command\.?$/i,
        /^you do not have permission/i,
        /^cannot\s/i,
        /^invalid\s/i,
        /^count must\s/i,
        /^user(?:\s+'.*')?\snot found\.?$/i,
        /^unknown item\s/i,
        /^item\s+.*\s+not found\.?$/i,
        /^failed\s/i
    ];

    private static toExecutionResult(message: string): CommandExecutionResult {
        const trimmed = (message || '').trim();
        const success = !this.failureMessagePatterns.some((pattern) => pattern.test(trimmed));
        return {
            success,
            message: trimmed
        };
    }

    // Basic duration parser (1d, 2h, 30m, 10s)
    static parseDuration(durationStr: string): number | null {
        const regex = /^(\d+)([dhms])$/;
        const match = durationStr.match(regex);
        if (!match) return null;

        const value = parseInt(match[1]);
        const unit = match[2];
        
        switch (unit) {
            case 'd': return value * 24 * 60 * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'm': return value * 60 * 1000;
            case 's': return value * 1000;
            default: return null;
        }
    }

    static async handleCommand(
        command: string, 
        args: string[], 
        issuerId: string, 
        issuerName: string
    ): Promise<CommandExecutionResult> {
        // fetch issuer to check permissions
        const issuer = await User.findById(issuerId);
        if (!issuer || !issuer.permissions.includes('game.admin')) {
            return this.toExecutionResult("You do not have permission to use this command.");
        }

        let message: string;
        switch (command.toLowerCase()) {
            case 'ban':
                message = await this.handleBan(args, issuerName);
                break;
            case 'tempban':
                message = await this.handleTempBan(args, issuerName);
                break;
            case 'mute':
                message = await this.handleMute(args, issuerName);
                break;
            case 'tempmute':
                message = await this.handleTempMute(args, issuerName);
                break;
            case 'unban':
                message = await this.handleUnban(args, issuerName);
                break;
            case 'unmute':
                message = await this.handleUnmute(args, issuerName);
                break;
            case 'broadcast':
                message = this.handleBroadcast(args, issuerName);
                break;
            case 'reboot':
                message = this.handleReboot(issuerName);
                break;
            case 'give':
                message = await this.handleGive(args, issuerName);
                break;
            case 'pay':
                message = await this.handlePay(args, issuerName);
                break;
            case 'drop':
                message = await this.handleDrop(args, issuerName);
                break;
            case 'send':
                message = await this.handleSend(args, issuerName);
                break;
            case 'clearprogress':
                message = await this.handleClearProgress(args);
                break;
            case 'wipe':
                message = await this.handleWipe(args);
                break;
            default:
                message = "Unknown command.";
                break;
        }

        return this.toExecutionResult(message);
    }

    private static async getUserByUsername(username: string) {
        return User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
    }

    private static async handleBan(args: string[], issuer: string): Promise<string> {
        if (args.length < 1) return "Usage: /ban [username]";
        const targetName = args[0];
        const user = await this.getUserByUsername(targetName);
        
        if (!user) return `User '${targetName}' not found.`;
        if (user.permissions.includes('game.admin')) return "Cannot ban an admin.";

        // Ban forever (well, 1000 years)
        const banUntil = new Date(Date.now() + 1000 * 365 * 24 * 60 * 60 * 1000); 
        user.bannedUntil = banUntil;
        await user.save();

        // Also ban their IP if known
        if (user.lastKnownIP) {
            await BannedIP.findOneAndUpdate(
                { ip: user.lastKnownIP },
                { 
                    ip: user.lastKnownIP,
                    bannedUntil: banUntil,
                    reason: 'Associated with banned user',
                    originalUserId: user._id.toString(),
                    originalUsername: user.username
                },
                { upsert: true }
            );
        }

        // Kick online players via InstanceManager event
        InstanceManager.getInstance().events.emit('ban', user._id.toString());

        return `User ${user.username} has been permanently banned${user.lastKnownIP ? ' (IP also banned)' : ''}.`;
    }

    private static async handleTempBan(args: string[], issuer: string): Promise<string> {
        if (args.length < 2) return "Usage: /tempban [username] [duration]";
        const targetName = args[0];
        const durationStr = args[1];

        const ms = this.parseDuration(durationStr);
        if (!ms) return "Invalid duration format. Use 1d, 2h, 30m, etc.";

        const user = await this.getUserByUsername(targetName);
        if (!user) return `User '${targetName}' not found.`;
        if (user.permissions.includes('game.admin')) return "Cannot ban an admin.";

        const banUntil = new Date(Date.now() + ms);
        user.bannedUntil = banUntil;
        await user.save();

        // Also ban their IP if known
        if (user.lastKnownIP) {
            await BannedIP.findOneAndUpdate(
                { ip: user.lastKnownIP },
                { 
                    ip: user.lastKnownIP,
                    bannedUntil: banUntil,
                    reason: 'Associated with temp-banned user',
                    originalUserId: user._id.toString(),
                    originalUsername: user.username
                },
                { upsert: true }
            );
        }

        InstanceManager.getInstance().events.emit('ban', user._id.toString());

        return `User ${user.username} banned for ${durationStr}${user.lastKnownIP ? ' (IP also banned)' : ''}.`;
    }

    private static async handleMute(args: string[], issuer: string): Promise<string> {
        if (args.length < 1) return "Usage: /mute [username]";
        const targetName = args[0];
        
        const user = await this.getUserByUsername(targetName);
        if (!user) return `User '${targetName}' not found.`;

        user.mutedUntil = new Date(Date.now() + 1000 * 365 * 24 * 60 * 60 * 1000); // 1000 years
        await user.save();
        
        // Notify if online?
        InstanceManager.getInstance().events.emit('msg_user', { userId: user._id.toString(), message: "You have been permanently muted." });

        return `User ${user.username} has been permanently muted.`;
    }

    private static async handleTempMute(args: string[], issuer: string): Promise<string> {
        if (args.length < 2) return "Usage: /tempmute [username] [duration]";
        const targetName = args[0];
        const durationStr = args[1];
        
        const ms = this.parseDuration(durationStr);
        if (!ms) return "Invalid duration format.";

        const user = await this.getUserByUsername(targetName);
        if (!user) return `User '${targetName}' not found.`;

        user.mutedUntil = new Date(Date.now() + ms);
        await user.save();

        InstanceManager.getInstance().events.emit('msg_user', { userId: user._id.toString(), message: `You have been muted for ${durationStr}.` });

        return `User ${user.username} muted for ${durationStr}.`;
    }

    private static async handleUnban(args: string[], issuer: string): Promise<string> {
        if (args.length < 1) return "Usage: /unban [username]";
        const user = await this.getUserByUsername(args[0]);
        if (!user) return "User not found.";

        user.bannedUntil = undefined;
        await user.save();
        
        // Also remove IP ban if they had one
        if (user.lastKnownIP) {
            await BannedIP.deleteOne({ ip: user.lastKnownIP });
        }
        
        return `User ${user.username} unbanned${user.lastKnownIP ? ' (IP also unbanned)' : ''}.`;
    }

    private static async handleUnmute(args: string[], issuer: string): Promise<string> {
        if (args.length < 1) return "Usage: /unmute [username]";
        const user = await this.getUserByUsername(args[0]);
        if (!user) return "User not found.";

        user.mutedUntil = undefined;
        await user.save();
        
        InstanceManager.getInstance().events.emit('msg_user', { userId: user._id.toString(), message: "You have been unmuted." });

        return `User ${user.username} unmuted.`;
    }

    private static handleBroadcast(args: string[], issuer: string): string {
        const msg = args.join(' ');
        if (!msg) return "Usage: /broadcast [message]";

        InstanceManager.getInstance().events.emit('broadcast', `${msg}`);
        return "Broadcast sent.";
    }

    private static handleReboot(issuer: string): string {
        console.log(`[Command] Reboot initiated by ${issuer}`);
        InstanceManager.getInstance().events.emit('broadcast', "Server rebooting in 5 seconds...");
        
        setTimeout(() => {
            process.exit(0);
        }, 5000);

        return "Server rebooting...";
    }


    private static async handleGive(args: string[], issuer: string): Promise<string> {
        if (args.length < 2) return "Usage: /give [username] [item id] [count]";
        const targetName = args[0];
        const itemId = args[1];
        const amount = args.length >= 3 ? parseInt(args[2], 10) : 1;

        if (!Number.isFinite(amount) || amount <= 0) return "Count must be a positive number.";

        const itemDef = getItemDefinition(itemId);
        if (!itemDef) return `Unknown item '${itemId}'.`;

        const user = await this.getUserByUsername(targetName);
        if (!user) return `User '${targetName}' not found.`;
        const userId = user._id.toString();

        if (itemDef.category === 'Fish') {
            const glimmerState = await GlimmerbowlCache.getInstance().getState(userId);
            if (glimmerState.unlocked) {
                const entries = await GlimmerbowlCache.getInstance().addFish(userId, itemId, amount, 'regular');
                InstanceManager.getInstance().events.emit('glimmerbowl_update', {
                    userId,
                    entries,
                    unlocked: true
                });
            } else {
                const slots = await InventoryCache.getInstance().addItem(userId, itemId, amount);
                InstanceManager.getInstance().events.emit('inventory_update', {
                    userId,
                    items: slots
                });
            }
        } else {
            const slots = await InventoryCache.getInstance().addItem(userId, itemId, amount);
            InstanceManager.getInstance().events.emit('inventory_update', {
                userId,
                items: slots
            });
            if (itemDef.scar && !(user as any).hasOwnedScar) {
                user.set('hasOwnedScar', true);
                await user.save();
            }
        }

        // because of the new inventory monitor ui, this isn't needed
        // InstanceManager.getInstance().events.emit('msg_user', {
        //     userId: user._id.toString(),
        //     message: `You received ${amount} ${itemDef.name}.`
        // });

        return `Gave ${amount} ${itemDef.name} to ${user.username}.`;
    }

    private static async handlePay(args: string[], issuer: string): Promise<string> {
        if (args.length < 2) return "Usage: /pay [username] [amount]";
        const targetName = args[0];
        const amount = parseInt(args[1], 10);
        if (!Number.isFinite(amount)) return "Invalid amount.";

        const user = await this.getUserByUsername(targetName);
        if (!user) return `User '${targetName}' not found.`;

        const currentMoney = Math.max(0, Math.floor(Number((user as any).money) || 0));
        const nextMoney = Math.max(0, currentMoney + amount);

        user.set('money', nextMoney);
        await user.save();

        InstanceManager.getInstance().events.emit('money_update', {
            userId: user._id.toString(),
            money: nextMoney
        });

        const signedDelta = nextMoney - currentMoney;
        return `Updated ${user.username} money by ${signedDelta}. New balance: ${nextMoney}.`;
    }

    private static async handleDrop(args: string[], issuer: string): Promise<string> {
        if (args.length < 2) return "Usage: /drop [username] [item id] [count]";
        const targetName = args[0];
        const itemId = args[1];
        const amount = args.length >= 3 ? parseInt(args[2], 10) : 1;

        if (!Number.isFinite(amount) || amount <= 0) return "Count must be a positive number.";

        const itemDef = getItemDefinition(itemId);
        if (!itemDef) return `Unknown item '${itemId}'.`;

        const user = await this.getUserByUsername(targetName);
        if (!user) return `User '${targetName}' not found.`;

        InstanceManager.getInstance().events.emit('drop_item', {
            userId: user._id.toString(),
            itemId,
            amount
        });

        InstanceManager.getInstance().events.emit('msg_user', {
            userId: user._id.toString(),
            message: `Dropped ${amount} ${itemDef.name} at your feet.`
        });

        return `Dropped ${amount} ${itemDef.name} at ${user.username}.`;
    }

    private static async handleSend(args: string[], issuer: string): Promise<string> {
        if (args.length < 2) return "Usage: /send [username] [server]";

        const targetName = args[0];
        const targetLocationId = args[1].trim().toLowerCase();
        const instanceManager = InstanceManager.getInstance();

        if (!instanceManager.getLocationConfig(targetLocationId)) {
            return `Unknown server '${targetLocationId}'.`;
        }

        const user = await this.getUserByUsername(targetName);
        if (!user) return `User '${targetName}' not found.`;

        user.lastLocationId = targetLocationId;
        user.lastPositionX = null;
        user.lastPositionY = null;
        await user.save();

        instanceManager.events.emit('send_user', {
            userId: user._id.toString(),
            locationId: targetLocationId,
            forceMapSpawn: true
        });

        return `Sent ${user.username} to ${targetLocationId}.`;
    }

    private static async handleClearProgress(args: string[]): Promise<string> {
        if (args.length < 1) return 'Usage: /clearprogress [username]';

        const targetName = args[0];
        const user = await this.getUserByUsername(targetName);
        if (!user) return `User '${targetName}' not found.`;

        user.set('advancements', {
            enrolled: DEFAULT_USER_ADVANCEMENTS.enrolled,
            questProgress: {},
            completedAchievements: [],
            discoveredRegions: {},
            tutorial: { ...DEFAULT_GUIDE_TUTORIAL_STATE }
        });
        await user.save();

        InstanceManager.getInstance().events.emit('clear_progress', {
            userId: user._id.toString()
        });

        return `Cleared advancement progress for ${user.username}.`;
    }

    private static async handleWipe(args: string[]): Promise<string> {
        if (args.length < 1) return 'Usage: /wipe [username]';

        const targetName = args[0];
        const user = await this.getUserByUsername(targetName);
        if (!user) return `User '${targetName}' not found.`;

        const resetInventory = createEmptyInventorySlots();

        await User.updateOne(
            { _id: user._id },
            {
                $set: {
                    inventory: resetInventory,
                    glimmerbowl: [],
                    equippedRodId: null,
                    playerStats: { ...DEFAULT_PLAYER_STATS },
                    money: 0,
                    advancements: {
                        enrolled: DEFAULT_USER_ADVANCEMENTS.enrolled,
                        questProgress: {},
                        completedAchievements: [],
                        discoveredRegions: {},
                        tutorial: { ...DEFAULT_GUIDE_TUTORIAL_STATE }
                    },
                    glimmerbowlUnlocked: false,
                    hasOwnedScar: false,
                    hearts: { ...DEFAULT_PLAYER_HEARTS_STATE },
                    lastLocationId: DEFAULT_FIRST_CONNECT_LOCATION_ID,
                    lastPositionX: null,
                    lastPositionY: null
                }
            }
        );

        const userId = user._id.toString();
        const inventoryCache = InventoryCache.getInstance();
        const glimmerbowlCache = GlimmerbowlCache.getInstance();
        const playerStatsCache = PlayerStatsCache.getInstance();

        const items = inventoryCache.resetUserInventory(userId);
        const entries = glimmerbowlCache.resetUser(userId);
        playerStatsCache.resetUser(userId);

        const instanceManager = InstanceManager.getInstance();
        instanceManager.events.emit('clear_progress', { userId });
        instanceManager.events.emit('inventory_update', { userId, items });
        instanceManager.events.emit('glimmerbowl_update', { userId, entries, unlocked: false });
        instanceManager.events.emit('money_update', { userId, money: 0 });
        instanceManager.events.emit('wipe_user', { userId });

        return `Wiped gameplay data for ${user.username}.`;
    }
}
