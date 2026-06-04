import { WASocket, WAMessage } from 'baileys';
import fs from 'fs';
import path from 'path';
import config from '../config';
import dataManager from './dataManager';
import { isBotAdmin as checkBotAdmin, isGroupAdmin as checkGroupAdmin } from '../middleware/auth';
import { Command } from '../types/Command';
import { getGroupMetadata } from './groupCache';
import { isRateLimited } from '../middleware/rateLimit';
import log from '../utils/logger';
import { normalizeBotId } from '../utils/jid';
import { t } from '../utils/lang';

const hlog = log.child({ module: 'handler' });

const commands = new Map<string, Command>();
const commandsPath = path.join(__dirname, '../commands');

function loadCommands(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    const tsFiles = new Set(files.filter(f => f.endsWith('.ts')));

    for (const file of files) {
        const fullPath = path.join(dir, file);

        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            loadCommands(fullPath);
            continue;
        }

        if (file.endsWith('.d.ts')) continue;
        if (!(file.endsWith('.js') || file.endsWith('.ts'))) continue;
        if (file.endsWith('.js') && tsFiles.has(file.replace('.js', '.ts'))) continue;

        try {
            const commandModule = require(fullPath);
            const candidate = commandModule.default || commandModule;

            if (candidate.name && candidate.execute) {
                const command = candidate as Command;
                const relativePath = path.relative(commandsPath, dir);
                const category = relativePath || 'Main';
                command.category = category.charAt(0).toUpperCase() + category.slice(1);

                commands.set(command.name.toLowerCase(), command);
                if (command.aliases) {
                    for (const alias of command.aliases) {
                        commands.set(alias.toLowerCase(), command);
                    }
                }
            }
        } catch (error) {
            hlog.error({ err: error, file }, 'Failed to load command');
        }
    }
}

loadCommands(commandsPath);

hlog.info(
    { commands: commands.size, prefix: config.prefix, admins: config.adminNumbers.length },
    'Commands loaded'
);

function extractBody(msg: WAMessage): string {
    const m = msg.message;
    if (!m) return '';

    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        ''
    );
}

function escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const sentMessageIds = new Set<string>();

export function trackSentMessage(id: string): void {
    sentMessageIds.add(id);
    if (sentMessageIds.size > 1000) {
        const first = sentMessageIds.values().next().value;
        if (first !== undefined) {
            sentMessageIds.delete(first);
        }
    }
}

async function messageHandler(
    sock: WASocket,
    update: { messages: WAMessage[]; type: string }
): Promise<void> {
    try {
        const msg = update.messages[0];
        if (!msg.message) return;

        if (msg.key.fromMe) {
            if (!config.selfBot || (msg.key.id && sentMessageIds.has(msg.key.id))) {
                return;
            }
        }

        const remoteJid = msg.key.remoteJid || '';
        const remoteJidAlt = (msg.key as any).remoteJidAlt as string | undefined;
        let from = remoteJid;
        const isGroup = from.endsWith('@g.us');

        // Normalize DM target JID to PN when available.
        // Newer WhatsApp/Baileys flows may deliver DMs with @lid, and PN is exposed in remoteJidAlt.
        if (!isGroup && from.endsWith('@lid') && remoteJidAlt?.endsWith('@s.whatsapp.net')) {
            from = remoteJidAlt;
        }


        let sender = isGroup
            ? (msg.key.participantAlt || msg.key.participant || '')
            : (remoteJidAlt || msg.key.participant || from);

        if (sender.includes(':')) {
            const num = sender.split(':')[0];
            const suffix = sender.split('@')[1] || 's.whatsapp.net';
            sender = `${num}@${suffix}`;
        }

        const senderNumber = sender.split('@')[0];
        const pushname = msg.pushName || senderNumber;

        const isBotAdmin = checkBotAdmin(sender);

        let isGroupAdmin = false;
        let isUser = false;
        let groupName = '';

        if (isGroup) {
            try {
                const metadata = await getGroupMetadata(sock, from);
                groupName = metadata.subject;
                isGroupAdmin = checkGroupAdmin(metadata.participants, sender);
                isUser = !isBotAdmin && !isGroupAdmin;
            } catch {
                groupName = 'Group';
                isUser = true;
            }
        } else {
            isUser = true;
        }

        if (!isGroup && !isBotAdmin && config.blockDms) return;

        const body = extractBody(msg);
        if (!body.trim()) return;

        const botId = normalizeBotId(sock);
        await dataManager.loadPrefixes(botId);

        if (isGroup && !isGroupAdmin && !isBotAdmin && /(https?:\/\/\S+|www\.\S+)/i.test(body)) {
            const settings = await dataManager.db.getGroupSettings(botId, from);
            if (settings && settings.antilinkMode !== 'off') {
                let metadata = await getGroupMetadata(sock, from).catch(() => null);
                let amIBotAdmin = metadata ? checkGroupAdmin(metadata.participants, botId) : false;

                if (metadata && !amIBotAdmin) {
                    const { invalidateGroupCache } = require('./groupCache');
                    invalidateGroupCache(from);
                    metadata = await getGroupMetadata(sock, from).catch(() => null);
                    amIBotAdmin = metadata ? checkGroupAdmin(metadata.participants, botId) : false;
                }

                if (amIBotAdmin) {
                    hlog.info({ from, sender }, `Antilink triggered for ${sender}`);

                    await sock.sendMessage(from, { delete: msg.key });

                    if (settings.antilinkMode === 'kick') {
                        await sock.groupParticipantsUpdate(from, [sender], 'remove');
                        await sock.sendMessage(from, { text: t('antilink_kick', { user: senderNumber }, settings.language), mentions: [sender] });
                    }
                    return;
                }
            }
        }

        // --- BADWORD FILTER START ---
        if (isGroup && !isGroupAdmin && !isBotAdmin) {
            const badwords = await dataManager.db.getBadwords(botId, from);
            if (badwords.length > 0) {
                // Determine if bot is admin to delete message
                let metadata = await getGroupMetadata(sock, from).catch(() => null);
                let amIBotAdmin = metadata ? checkGroupAdmin(metadata.participants, botId) : false;

                if (metadata && !amIBotAdmin) {
                    const { invalidateGroupCache } = require('./groupCache');
                    invalidateGroupCache(from);
                    metadata = await getGroupMetadata(sock, from).catch(() => null);
                    amIBotAdmin = metadata ? checkGroupAdmin(metadata.participants, botId) : false;
                }

                if (amIBotAdmin) {
                    const bodyLower = body.toLowerCase();
                    const containsBadword = badwords.some(word => {
                        // Match standalone words or surrounded by non-alphanumeric chars
                        const safeWord = escapeRegex(word.toLowerCase().trim());
                        const regex = new RegExp(`(^|[^a-zA-Z0-9_])${safeWord}([^a-zA-Z0-9_]|$)`, 'i');
                        return regex.test(bodyLower);
                    });

                    if (containsBadword) {
                        hlog.info({ from, sender }, `Badword triggered for ${sender}`);
                        await sock.sendMessage(from, { delete: msg.key });
                        return; // Stop processing further commands
                    }
                }
            }
        }
        // --- BADWORD FILTER END ---

        const prefix = dataManager.getPrefix(botId, from, config.prefix);

        if (body.startsWith(prefix) && prefix.length > 0) {
            const args = body.slice(prefix.length).trim().split(/ +/);
            const commandName = args.shift()?.toLowerCase() || '';

            const command = commands.get(commandName);
            if (!command) return;

            let lang = 'en';
            if (isGroup) {
                const settings = await dataManager.db.getGroupSettings(botId, from);
                lang = settings.language || 'en';
            }

            if (!isBotAdmin && isRateLimited(sender)) return;

            if (command.devOnly && !isBotAdmin) {
                await sock.sendMessage(from, { text: t('dev_only', undefined, lang) }, { quoted: msg });
                return;
            }

            if (command.groupAdminOnly && !isGroupAdmin && !isBotAdmin) {
                await sock.sendMessage(from, { text: t('admin_only', undefined, lang) }, { quoted: msg });
                return;
            }
            if (command.userOnly && !isUser) {
                await sock.sendMessage(from, { text: t('user_only', undefined, lang) }, { quoted: msg });
                return;
            }

            const role = isBotAdmin ? 'DEV' : isGroupAdmin ? 'ADMIN' : 'USER';
            const location = isGroup ? groupName : 'DM';
            hlog.info(`${prefix}${commandName} | ${pushname} | ${location} | ${role}`);

            const context = {
                botId,
                isBotAdmin,
                isGroupAdmin,
                isUser,
                commands,
                prefix,
                from,
                pushname,
                groupName,
                dataManager,
                lang,
                t: (key: string, replacements?: Record<string, string>) => t(key, replacements, lang),
            };

            await command.execute(sock, msg, args, context);
        }
    } catch (error) {
        hlog.error({ err: error }, 'Message handler error');
    }
}

export default messageHandler;

