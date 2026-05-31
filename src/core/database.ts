import sqlite3 from 'sqlite3';
import { open, Database as SQLiteDatabase } from 'sqlite';
import path from 'path';
import fs from 'fs/promises';
import log from '../utils/logger';

const dblog = log.child({ module: 'database' });

// --- Row interfaces ---

interface PrefixRow {
    bot_id: string;
    chat_id: string;
    prefix: string;
}

interface GroupSettingsRow {
    bot_id: string;
    group_id: string;
    welcome_enabled: number;
    goodbye_enabled: number;
    welcome_message: string | null;
    goodbye_message: string | null;
    welcome_image: string | null;
    goodbye_image: string | null;
    lock_message: string | null;
    unlock_message: string | null;
    antilink_mode: string;
}

/**
 * Singleton SQLite database wrapper.
 * Provides typed CRUD helpers for every domain table.
 */
class Database {
    private db: SQLiteDatabase | null = null;
    private dbPath: string = path.join(__dirname, '../../data/database.sqlite');

    // --- Lifecycle ---

    /** Open the database file and ensure all tables exist. */
    async init(): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

            this.db = await open({
                filename: this.dbPath,
                driver: sqlite3.Database
            });

            // Enable WAL mode for better concurrency in NodeJS
            await this.db.exec(`
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;
                PRAGMA busy_timeout = 5000;
                PRAGMA foreign_keys = ON;
            `);

            await this.createTables();
            dblog.info('Connected to SQLite database (WAL mode)');
        } catch (error) {
            dblog.error({ err: error }, 'Error connecting to database');
            throw error;
        }
    }

    /** Create tables and run lightweight migrations. */
    private async createTables(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS prefixes (
                bot_id TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                prefix TEXT NOT NULL,
                PRIMARY KEY (bot_id, chat_id)
            )
        `);

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS group_settings (
                bot_id TEXT NOT NULL,
                group_id TEXT NOT NULL,
                welcome_enabled INTEGER DEFAULT 0,
                goodbye_enabled INTEGER DEFAULT 0,
                welcome_message TEXT,
                goodbye_message TEXT,
                lock_message TEXT,
                unlock_message TEXT,
                antilink_mode TEXT DEFAULT 'off',
                PRIMARY KEY (bot_id, group_id)
            )
        `);

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS badwords (
                bot_id TEXT NOT NULL,
                group_id TEXT NOT NULL,
                word TEXT NOT NULL,
                PRIMARY KEY (bot_id, group_id, word)
            )
        `);

        // Performance Indices
        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_badwords_group ON badwords(bot_id, group_id);
        `);

        // Safe column migrations (no-op if column already exists)
        try { await this.db.run('ALTER TABLE group_settings ADD COLUMN welcome_enabled INTEGER DEFAULT 0'); } catch { }
        try { await this.db.run('ALTER TABLE group_settings ADD COLUMN goodbye_enabled INTEGER DEFAULT 0'); } catch { }
        try { await this.db.run("ALTER TABLE group_settings ADD COLUMN antilink_mode TEXT DEFAULT 'off'"); } catch { }
        try { await this.db.run('ALTER TABLE group_settings ADD COLUMN lock_message TEXT'); } catch { }
        try { await this.db.run('ALTER TABLE group_settings ADD COLUMN unlock_message TEXT'); } catch { }
        try { await this.db.run('ALTER TABLE group_settings ADD COLUMN welcome_image TEXT'); } catch { }
        try { await this.db.run('ALTER TABLE group_settings ADD COLUMN goodbye_image TEXT'); } catch { }
    }


    // --- Prefix methods ---

    /** Get the custom prefix for a chat, or null if using default. */
    async getPrefix(botId: string, chatId: string): Promise<string | null> {
        if (!this.db) throw new Error('Database not initialized');
        const result = await this.db.get<PrefixRow>('SELECT prefix FROM prefixes WHERE bot_id = ? AND chat_id = ?', botId, chatId);
        return result ? result.prefix : null;
    }

    /** Set a custom prefix for a chat. */
    async setPrefix(botId: string, chatId: string, prefix: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        await this.db.run(
            'INSERT OR REPLACE INTO prefixes (bot_id, chat_id, prefix) VALUES (?, ?, ?)',
            botId, chatId, prefix
        );
    }

    /** Remove the custom prefix for a chat, reverting to default. */
    async deletePrefix(botId: string, chatId: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        await this.db.run('DELETE FROM prefixes WHERE bot_id = ? AND chat_id = ?', botId, chatId);
    }

    /** Return a map of all custom prefixes keyed by chat ID for a specific bot. */
    async getAllPrefixes(botId: string): Promise<Record<string, string>> {
        if (!this.db) throw new Error('Database not initialized');
        const rows = await this.db.all<PrefixRow[]>('SELECT * FROM prefixes WHERE bot_id = ?', botId);
        const prefixes: Record<string, string> = {};
        for (const row of rows) {
            prefixes[row.chat_id] = row.prefix;
        }
        return prefixes;
    }

    // --- Badwords methods ---

    /** Add a badword to the group's blocklist */
    async addBadword(botId: string, groupId: string, word: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        await this.db.run(
            'INSERT OR IGNORE INTO badwords (bot_id, group_id, word) VALUES (?, ?, ?)',
            botId, groupId, word.toLowerCase()
        );
    }

    /** Remove a badword from the group's blocklist */
    async removeBadword(botId: string, groupId: string, word: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        await this.db.run(
            'DELETE FROM badwords WHERE bot_id = ? AND group_id = ? AND word = ?',
            botId, groupId, word.toLowerCase()
        );
    }

    /** Get all badwords for a specific group */
    async getBadwords(botId: string, groupId: string): Promise<string[]> {
        if (!this.db) throw new Error('Database not initialized');
        const rows = await this.db.all<{ word: string }[]>(
            'SELECT word FROM badwords WHERE bot_id = ? AND group_id = ?',
            botId, groupId
        );
        return rows.map(r => r.word);
    }

    // --- Group settings methods ---

    /** Get welcome/goodbye/lock/unlock messages and modes for a group. */
    async getGroupSettings(botId: string, groupId: string): Promise<{
        welcome: string | null,
        goodbye: string | null,
        welcomeImage: string | null,
        goodbyeImage: string | null,
        lock: string | null,
        unlock: string | null,
        welcomeEnabled: boolean,
        goodbyeEnabled: boolean,
        antilinkMode: string
    }> {
        if (!this.db) throw new Error('Database not initialized');
        const row = await this.db.get<GroupSettingsRow>(
            'SELECT * FROM group_settings WHERE bot_id = ? AND group_id = ?',
            botId, groupId
        );
        return {
            welcome: row?.welcome_message || null,
            goodbye: row?.goodbye_message || null,
            welcomeImage: row?.welcome_image || null,
            goodbyeImage: row?.goodbye_image || null,
            lock: row?.lock_message || null,
            unlock: row?.unlock_message || null,
            welcomeEnabled: Boolean(row?.welcome_enabled),
            goodbyeEnabled: Boolean(row?.goodbye_enabled),
            antilinkMode: row?.antilink_mode || 'off'
        };
    }

    private async updateGroupSetting(botId: string, groupId: string, column: string, value: any): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        await this.db.run(
            `INSERT INTO group_settings (bot_id, group_id, ${column}) VALUES (?, ?, ?)
             ON CONFLICT(bot_id, group_id) DO UPDATE SET ${column} = ?`,
            botId, groupId, value, value
        );
    }

    async setWelcomeMessage(botId: string, groupId: string, message: string | null) { return this.updateGroupSetting(botId, groupId, 'welcome_message', message); }
    async setGoodbyeMessage(botId: string, groupId: string, message: string | null) { return this.updateGroupSetting(botId, groupId, 'goodbye_message', message); }
    async setWelcomeImage(botId: string, groupId: string, imagePath: string | null) { return this.updateGroupSetting(botId, groupId, 'welcome_image', imagePath); }
    async setGoodbyeImage(botId: string, groupId: string, imagePath: string | null) { return this.updateGroupSetting(botId, groupId, 'goodbye_image', imagePath); }
    async setLockMessage(botId: string, groupId: string, message: string | null) { return this.updateGroupSetting(botId, groupId, 'lock_message', message); }
    async setUnlockMessage(botId: string, groupId: string, message: string | null) { return this.updateGroupSetting(botId, groupId, 'unlock_message', message); }

    async toggleWelcome(botId: string, groupId: string, enabled: boolean): Promise<void> {
        await this.updateGroupSetting(botId, groupId, 'welcome_enabled', enabled ? 1 : 0);
    }

    async toggleGoodbye(botId: string, groupId: string, enabled: boolean): Promise<void> {
        await this.updateGroupSetting(botId, groupId, 'goodbye_enabled', enabled ? 1 : 0);
    }

    async setAntilinkMode(botId: string, groupId: string, mode: string): Promise<void> {
        await this.updateGroupSetting(botId, groupId, 'antilink_mode', mode);
    }
}

export default new Database();
