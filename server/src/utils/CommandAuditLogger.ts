import fs from 'fs';
import path from 'path';

export type CommandAuditEntry = {
    timestamp: string;
    playerId: string;
    playerUsername: string;
    command: string;
    args: string[];
    success: boolean;
    resultMessage?: string;
};

export class CommandAuditLogger {
    private static initialized = false;
    private static readonly logDir = path.resolve(__dirname, '..', '..', 'logs');
    private static readonly logFilePath = path.join(CommandAuditLogger.logDir, 'commands.log');

    private static ensureInitialized() {
        if (CommandAuditLogger.initialized) return;
        fs.mkdirSync(CommandAuditLogger.logDir, { recursive: true });
        CommandAuditLogger.initialized = true;
    }

    static async log(entry: CommandAuditEntry) {
        try {
            CommandAuditLogger.ensureInitialized();
            const line = `${JSON.stringify(entry)}\n`;
            await fs.promises.appendFile(CommandAuditLogger.logFilePath, line, 'utf8');
        } catch (error) {
            console.error('[CommandAuditLogger] Failed to write command audit entry:', error);
        }
    }
}
