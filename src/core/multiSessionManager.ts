import { Session } from './session';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import log from '../utils/logger';
import config from '../config';

const mlog = log.child({ module: 'manager' });

let managerInstance: MultiSessionManager | null = null;

export function getSessionManager(): MultiSessionManager | null {
    return managerInstance;
}

export class MultiSessionManager {
    private sessions: Map<string, Session>;
    private sessionsDir: string;

    constructor() {
        this.sessions = new Map();
        this.sessionsDir = path.join(process.cwd(), 'data', 'sessions');

        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }

        managerInstance = this;
    }

    async init() {
        if (config.enableCli) {
            console.clear();
            console.log('\x1b[36m%s\x1b[0m', '=========================================');
            console.log('\x1b[36m%s\x1b[0m', '             YAMORI BOT MANAGER          ');
            console.log('\x1b[36m%s\x1b[0m', '=========================================');
        }

        await this.loadSessions();

        if (config.enableCli) {
            this.startCLI();
        } else {
            mlog.info('Bot initialized in daemon mode. CLI dashboard disabled.');
        }
    }

    async loadSessions() {
        const folders = fs.readdirSync(this.sessionsDir).filter(f =>
            fs.statSync(path.join(this.sessionsDir, f)).isDirectory()
        );

        mlog.info(`Found ${folders.length} session(s).`);

        for (const id of folders) {
            await this.startSession(id);
        }
    }

    async startSession(sessionId: string, phoneNumber?: string) {
        if (this.sessions.has(sessionId)) {
            mlog.warn(`Session ${sessionId} already loaded.`);
            return;
        }

        const session = new Session(sessionId);
        this.sessions.set(sessionId, session);
        await session.start(phoneNumber);
    }

    async addSession(sessionId: string, phoneNumber?: string) {
        if (this.sessions.has(sessionId)) {
            console.log(`\x1b[33mSession ${sessionId} already exists. Deleting to re-pair...\x1b[0m`);
            await this.deleteSession(sessionId);
        }

        await this.startSession(sessionId, phoneNumber);
    }

    async deleteSession(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (session) {
            try { session.sock?.end(undefined); } catch { }
            this.sessions.delete(sessionId);
        }

        const sessionPath = path.join(this.sessionsDir, sessionId);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        try {
            const { storeManager } = require('./storeManager');
            storeManager.deleteStore(sessionId);
        } catch { }

        mlog.info(`Session ${sessionId} deleted.`);
    }

    getSessionStatuses(): { id: string; connected: boolean; user: string }[] {
        const result: { id: string; connected: boolean; user: string }[] = [];
        for (const [id, session] of this.sessions) {
            const connected = session.sock?.ws?.isOpen ?? false;
            let user = '-';
            if (session.sock?.user) {
                const num = session.sock.user.id.split(':')[0];
                const name = session.sock.user.name || '';
                user = name ? `${name} (${num})` : num;
            }
            result.push({ id, connected, user });
        }
        return result;
    }

    async cleanDisconnected(): Promise<string[]> {
        const toRemove: string[] = [];
        for (const [id, session] of this.sessions) {
            const connected = session.sock?.ws?.isOpen ?? false;
            if (!connected) {
                toRemove.push(id);
            }
        }
        for (const id of toRemove) {
            await this.deleteSession(id);
        }
        return toRemove;
    }

    private printDashboard() {
        const sessionIds = Array.from(this.sessions.keys());

        if (sessionIds.length === 0) {
            console.log('\x1b[33m\n  No active sessions.\n\x1b[0m');
            return;
        }

        const rows: { id: string; status: string; statusRaw: string; user: string; uptime: string; msgs: string }[] = [];

        for (const id of sessionIds) {
            const session = this.sessions.get(id)!;
            let statusRaw = 'Unknown';
            let status = '\x1b[90mUnknown\x1b[0m'; // gray
            let user = '-';

            if (session.sock) {
                const connected = session.sock.ws?.isOpen ?? false;
                statusRaw = connected ? 'Connected' : 'Disconnected';
                status = connected ? '\x1b[32mConnected\x1b[0m' : '\x1b[31mDisconnected\x1b[0m'; // green / red

                // If it's not open but sock exists, it might be connecting
                if (!connected && !session.connectedAt) {
                    statusRaw = 'Connecting';
                    status = '\x1b[33mConnecting\x1b[0m'; // yellow
                }

                if (session.sock.user) {
                    const num = session.sock.user.id.split(':')[0];
                    const name = session.sock.user.name || '';
                    user = name ? `${name} (${num})` : num;
                }
            }

            rows.push({
                id,
                status,
                statusRaw,
                user,
                uptime: session.getUptime(),
                msgs: session.messagesProcessed.toString()
            });
        }

        const colW = {
            id: Math.max(10, ...rows.map(r => r.id.length)) + 2,
            status: Math.max(12, ...rows.map(r => r.statusRaw.length)) + 2,
            user: Math.max(8, ...rows.map(r => r.user.length)) + 2,
            uptime: Math.max(8, ...rows.map(r => r.uptime.length)) + 2,
            msgs: Math.max(6, ...rows.map(r => r.msgs.length)) + 2,
        };

        const pad = (s: string, w: number, noAnsiLen: number = s.length) => s + ' '.repeat(Math.max(0, w - noAnsiLen));
        const topBorder = `┌${'─'.repeat(colW.id)}┬${'─'.repeat(colW.status)}┬${'─'.repeat(colW.user)}┬${'─'.repeat(colW.uptime)}┬${'─'.repeat(colW.msgs)}┐`;
        const midBorder = `├${'─'.repeat(colW.id)}┼${'─'.repeat(colW.status)}┼${'─'.repeat(colW.user)}┼${'─'.repeat(colW.uptime)}┼${'─'.repeat(colW.msgs)}┤`;
        const bottomBorder = `└${'─'.repeat(colW.id)}┴${'─'.repeat(colW.status)}┴${'─'.repeat(colW.user)}┴${'─'.repeat(colW.uptime)}┴${'─'.repeat(colW.msgs)}┘`;
        const header = `│${pad(' Session', colW.id)}│${pad(' Status', colW.status)}│${pad(' User', colW.user)}│${pad(' Uptime', colW.uptime)}│${pad(' Msgs', colW.msgs)}│`;

        console.log('');
        console.log(topBorder);
        console.log(header);
        console.log(midBorder);

        for (const row of rows) {
            const line = `│${pad(' ' + row.id, colW.id)}│${pad(' ' + row.status, colW.status, row.statusRaw.length + 1)}│${pad(' ' + row.user, colW.user)}│${pad(' ' + row.uptime, colW.uptime)}│${pad(' ' + row.msgs, colW.msgs)}│`;
            console.log(line);
        }

        console.log(bottomBorder);

        const mem = process.memoryUsage();
        const heapUsed = mem.heapUsed / 1024 / 1024;
        const heapTotal = mem.heapTotal / 1024 / 1024;
        const percent = Math.round((heapUsed / heapTotal) * 100);
        
        // Simple visual bar: [██████░░░░]
        const barSize = 20;
        const filled = Math.round((percent / 100) * barSize);
        const bar = '█'.repeat(filled) + '░'.repeat(barSize - filled);
        const color = percent > 80 ? '\x1b[31m' : (percent > 60 ? '\x1b[33m' : '\x1b[32m');

        console.log(`  Heap Mem: [${color}${bar}\x1b[0m] ${heapUsed.toFixed(1)}MB / ${heapTotal.toFixed(1)}MB (${percent}%)`);
        console.log('');
    }

    private printLogs(count: number = 10) {
        const logPath = path.join(process.cwd(), 'data', 'logs', 'bot.log');
        if (!fs.existsSync(logPath)) {
            console.log('\x1b[33mNo log file found at data/logs/bot.log\x1b[0m');
            return;
        }

        try {
            const content = fs.readFileSync(logPath, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);
            const tail = lines.slice(-count);

            console.log(`\n\x1b[36m--- Last ${tail.length} Log Entries ---\x1b[0m\n`);
            tail.forEach(line => console.log(line));
            console.log('');
        } catch (error) {
            console.error('\x1b[31mFailed to read log file:\x1b[0m', error);
        }
    }

    private startCLI() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: '\x1b[36mbot>\x1b[0m '
        });

        console.log('\x1b[32mBot started in background. Type :help for commands.\x1b[0m\n');
        rl.prompt();

        rl.on('line', async (line: string) => {
            const input = line.trim();

            if (input === ':status') {
                this.printDashboard();
            } else if (input === ':help') {
                console.log(`
\x1b[36mCommands:\x1b[0m
  :status           - Show advanced dashboard
  :add <name> [num] - Add new session (with optional phone number to pair)
  :del <name>       - Delete session
  :restart <name>   - Restart specific session
  :clean            - Clean up all disconnected sessions
  :logs [n]         - View last N log lines (default 10)
  :clear            - Clear console
  :exit             - Stop bot
                `);
            } else if (input.startsWith(':add')) {
                const args = input.split(' ');
                const name = args[1];
                if (!name) {
                    console.log('\x1b[33mUsage: :add <name> [phone_number]\x1b[0m');
                } else {
                    await this.addSession(name, args[2]);
                }
            } else if (input.startsWith(':del')) {
                const args = input.split(' ');
                const name = args[1];
                if (!name) {
                    console.log('\x1b[33mUsage: :del <name>\x1b[0m');
                } else {
                    await this.deleteSession(name);
                }
            } else if (input.startsWith(':restart')) {
                const args = input.split(' ');
                const name = args[1];
                if (!name) {
                    console.log('\x1b[33mUsage: :restart <name>\x1b[0m');
                } else {
                    const session = this.sessions.get(name);
                    if (!session) {
                        console.log(`\x1b[33mSession ${name} not found.\x1b[0m`);
                    } else {
                        console.log(`Restarting session ${name}...`);
                        await session.stop();
                        await session.start();
                    }
                }
            } else if (input === ':clean') {
                const removed = await this.cleanDisconnected();
                console.log(`\x1b[32mCleaned up ${removed.length} disconnected sessions: ${removed.join(', ')}\x1b[0m`);
            } else if (input.startsWith(':logs')) {
                const args = input.split(' ');
                const count = args[1] ? parseInt(args[1], 10) : 10;
                this.printLogs(isNaN(count) ? 10 : count);
            } else if (input === ':clear') {
                console.clear();
            } else if (input === ':exit') {
                console.log('\x1b[31mStopping bot...\x1b[0m');
                process.exit(0);
            }

            rl.prompt();
        });
    }
}
