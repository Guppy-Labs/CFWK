import User from '../models/User';
import BannedIP from '../models/BannedIP';
import { InstanceManager } from '../managers/InstanceManager';
import { InventoryCache } from '../managers/InventoryCache';
import { getItemDefinition } from '@cfwk/shared';

export class CommandProcessor {
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
    ): Promise<string> {
        // fetch issuer to check permissions
        const issuer = await User.findById(issuerId);
        if (!issuer || !issuer.permissions.includes('game.admin')) {
            return "You do not have permission to use this command.";
        }

        switch (command.toLowerCase()) {
            case 'ban':
                return await this.handleBan(args, issuerName);
            case 'tempban':
                return await this.handleTempBan(args, issuerName);
            case 'mute':
                return await this.handleMute(args, issuerName);
            case 'tempmute':
                return await this.handleTempMute(args, issuerName);
            case 'unban':
                return await this.handleUnban(args, issuerName);
            case 'unmute':
                return await this.handleUnmute(args, issuerName);
            case 'broadcast':
                return this.handleBroadcast(args, issuerName);
            case 'reboot':
                return this.handleReboot(issuerName);
            case 'give':
                return await this.handleGive(args, issuerName);
            case 'drop':
                return await this.handleDrop(args, issuerName);
            default:
                return "Unknown command.";
        }
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

            const slots = await InventoryCache.getInstance().addItem(user._id.toString(), itemId, amount);

            InstanceManager.getInstance().events.emit('inventory_update', {
                userId: user._id.toString(),
                items: slots
            });

        // because of the new inventory monitor ui, this isn't needed
        // InstanceManager.getInstance().events.emit('msg_user', {
        //     userId: user._id.toString(),
        //     message: `You received ${amount} ${itemDef.name}.`
        // });

        return `Gave ${amount} ${itemDef.name} to ${user.username}.`;
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
}
