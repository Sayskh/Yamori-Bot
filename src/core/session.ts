import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    ConnectionState,
    WASocket
} from 'baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';
import log from '../utils/logger';
import messageHandler, { trackSentMessage } from './handler';
import { handleGroupParticipantsUpdate } from './groupHandler';
import { storeManager } from './storeManager';
import giveawayService from '../services/giveawayService';
import pino from 'pino';

const MAX_RETRIES = 10;
const BASE_DELAY = 2000;
const MAX_DELAY = 60000;
const STABLE_THRESHOLD = 30000;

export class Session {
    public sock: WASocket | undefined;
    public sessionId: string;
    private logger: ReturnType<typeof log.child>;
    private folderPath: string;
    private retryCount = 0;
    private eventsBound = false;
    private stableTimer: ReturnType<typeof setTimeout> | undefined;

    // Metrics for dashboard
    public connectedAt: Date | null = null;
    public messagesProcessed = 0;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
        this.logger = log.child({ session: sessionId });
        this.folderPath = path.join(process.cwd(), 'data', 'sessions', sessionId);

        if (!fs.existsSync(this.folderPath)) {
            fs.mkdirSync(this.folderPath, { recursive: true });
        }
    }

    async start(phoneNumber?: string) {
        this.eventsBound = false;

        const { state, saveCreds } = await useMultiFileAuthState(this.folderPath);
        const { version } = await fetchLatestBaileysVersion();

        this.logger.info(`Starting session ${this.sessionId} v${version.join('.')}`);

        const baileysLogger = pino({ level: 'silent' });

        this.sock = makeWASocket({
            version,
            logger: baileysLogger as any,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, baileysLogger as any),
            },
            browser: Browsers.ubuntu('Firefox'),
            generateHighQualityLinkPreview: false,
        });

        // Patch sendMessage to track outgoing message IDs for self-bot loop prevention
        const originalSendMessage = this.sock.sendMessage.bind(this.sock);
        this.sock.sendMessage = async (jid, content, options) => {
            const result = await originalSendMessage(jid, content, options);
            if (result?.key?.id) {
                trackSentMessage(result.key.id);
            }
            return result;
        };

        if (phoneNumber && !this.sock.authState.creds.registered) {
            setTimeout(async () => {
                if (this.sock && !this.sock.authState.creds.registered) {
                    try {
                        const code = await this.sock.requestPairingCode(this.formatPhone(phoneNumber));
                        console.log(`\n\x1b[32mCODE: \x1b[1m${code?.match(/.{1,4}/g)?.join('-') || code}\x1b[0m\n`);
                    } catch (err) {
                        this.logger.error({ err }, 'Failed to request pairing code');
                    }
                }
            }, 3000);
        }

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && !phoneNumber) {
                console.log(`\nScan QR for session: ${this.sessionId}`);
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

                const shouldReconnect =
                    statusCode !== DisconnectReason.loggedOut &&
                    statusCode !== DisconnectReason.connectionReplaced;

                this.logger.info(`Connection closed (code=${statusCode}), reconnecting=${shouldReconnect}`);

                if (this.stableTimer) {
                    clearTimeout(this.stableTimer);
                    this.stableTimer = undefined;
                }
                this.connectedAt = null;

                if (shouldReconnect) {
                    this.retryCount++;

                    if (this.retryCount > MAX_RETRIES) {
                        this.logger.error(`Max retries (${MAX_RETRIES}) exceeded, stopping session.`);
                        return;
                    }

                    const delay = Math.min(BASE_DELAY * Math.pow(2, this.retryCount - 1), MAX_DELAY);
                    this.logger.info(`Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${this.retryCount}/${MAX_RETRIES})`);

                    setTimeout(() => this.start(), delay);
                } else if (statusCode === DisconnectReason.connectionReplaced) {
                    this.logger.warn('Connection replaced by another client. Not reconnecting to avoid loop.');
                } else {
                    this.logger.info('Session logged out, cleaning up credentials.');
                    if (fs.existsSync(this.folderPath)) {
                        fs.rmSync(this.folderPath, { recursive: true, force: true });
                    }
                    storeManager.deleteStore(this.sessionId);
                }
            } else if (connection === 'open') {
                this.logger.info('Connection opened');
                this.connectedAt = new Date();
                this.bindEvents();

                giveawayService.restoreTimers(this.sock!).catch(err => {
                    this.logger.error({ err }, 'Failed to restore giveaway timers');
                });

                this.stableTimer = setTimeout(() => {
                    this.retryCount = 0;
                    this.logger.info('Connection stable, retry count reset.');
                }, STABLE_THRESHOLD);
            }
        });
    }

    private formatPhone(phone: string): string {
        return phone.replace(/[^0-9]/g, '');
    }

    private bindEvents() {
        if (!this.sock || this.eventsBound) return;
        this.eventsBound = true;

        this.sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            try {
                this.messagesProcessed++;
                await messageHandler(this.sock!, m);
            } catch (error) {
                this.logger.error({ err: error }, 'Handler error');
            }
        });

        this.sock.ev.on('group-participants.update', async (update) => {
            try {
                await handleGroupParticipantsUpdate(this.sock!, update as any);
            } catch (error) {
                this.logger.error({ err: error }, 'Group handler error');
            }
        });

        this.sock.ev.on('messages.reaction', async (reactions) => {
            for (const reaction of reactions) {
                try {
                    await giveawayService.handleReaction(this.sock!, reaction);
                } catch (error) {
                    this.logger.error({ err: error }, 'Giveaway reaction handler error');
                }
            }
        });

        try {
            storeManager.bind(this.sessionId, this.sock);
        } catch (e) {
            this.logger.error(e);
        }
    }

    async stop() {
        this.sock?.end(undefined);
        storeManager.deleteStore(this.sessionId);
    }

    getUptime(): string {
        if (!this.connectedAt) return '0s';
        const diffMs = Date.now() - this.connectedAt.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        
        if (diffSecs < 60) return `${diffSecs}s`;
        if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ${diffSecs % 60}s`;
        const hours = Math.floor(diffSecs / 3600);
        const minutes = Math.floor((diffSecs % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
}
