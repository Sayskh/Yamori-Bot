import database from './database';
import log from '../utils/logger';

const dlog = log.child({ module: 'data' });

export class DataManager {
    // Structure: { [botId]: { [chatId]: prefix } }
    private prefixes: Record<string, Record<string, string>> = {};
    private loadedBotIds = new Set<string>();

    async loadPrefixes(botId: string): Promise<Record<string, string>> {
        if (this.loadedBotIds.has(botId)) {
            return this.prefixes[botId] || {};
        }

        if (!this.prefixes[botId]) this.prefixes[botId] = {};

        try {
            this.prefixes[botId] = await database.getAllPrefixes(botId);
            this.loadedBotIds.add(botId);
        } catch (error) {
            dlog.error({ err: error }, 'Failed to load prefixes');
            this.prefixes[botId] = {};
        }
        return this.prefixes[botId];
    }

    async setPrefix(botId: string, chatId: string, prefix: string): Promise<boolean> {
        if (!this.prefixes[botId]) this.prefixes[botId] = {};
        try {
            await database.setPrefix(botId, chatId, prefix);
            this.prefixes[botId][chatId] = prefix;
            return true;
        } catch (error) {
            dlog.error({ err: error }, 'Failed to save prefix');
            return false;
        }
    }

    async deletePrefix(botId: string, chatId: string): Promise<boolean> {
        if (!this.prefixes[botId]) this.prefixes[botId] = {};
        try {
            await database.deletePrefix(botId, chatId);
            delete this.prefixes[botId][chatId];
            return true;
        } catch (error) {
            dlog.error({ err: error }, 'Failed to delete prefix');
            return false;
        }
    }

    getPrefix(botId: string, chatId: string, defaultPrefix: string): string {
        return this.prefixes[botId]?.[chatId] || defaultPrefix;
    }

    get db() {
        return database;
    }
}

export default new DataManager();
