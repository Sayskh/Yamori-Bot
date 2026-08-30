import { Command } from '../../types/Command';

const command: Command = {
    name: 'setclose',
    aliases: ['setgc'],
    description: 'Set custom message for group lock/unlock',
    usage: 'lock <message> / unlock <message>',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId, t } = context;
        const db = dataManager.db;

        if (args.length === 0) {
            const settings = await db.getGroupSettings(botId, from);

            await sock.sendMessage(from, {
                text: t('setlock_usage', {
                    prefix,
                    lock: settings.lock || '_(default)_',
                    unlock: settings.unlock || '_(default)_'
                }),
            }, { quoted: msg });
            return;
        }

        const type = args[0].toLowerCase();
        const message = args.slice(1).join(' ');

        if (type !== 'lock' && type !== 'unlock') {
            await sock.sendMessage(from, {
                text: t('setlock_invalid_type', { prefix }),
            }, { quoted: msg });
            return;
        }

        if (!message) {
            await sock.sendMessage(from, {
                text: t('setlock_empty_msg', { type, prefix }),
            }, { quoted: msg });
            return;
        }

        const MAX_MESSAGE_LENGTH = 2000;
        if (message.length > MAX_MESSAGE_LENGTH) {
            await sock.sendMessage(from, { text: t('message_limit') }, { quoted: msg });
            return;
        }

        if (message.toLowerCase() === 'off') {
            if (type === 'lock') {
                await db.setLockMessage(botId, from, null);
            } else {
                await db.setUnlockMessage(botId, from, null);
            }
            await sock.sendMessage(from, { text: t('setlock_reset', { type }) }, { quoted: msg });
            return;
        }

        if (type === 'lock') {
            await db.setLockMessage(botId, from, message);
        } else {
            await db.setUnlockMessage(botId, from, message);
        }

        await sock.sendMessage(from, {
            text: t('setlock_success', { type, message }),
        }, { quoted: msg });
    },
};

export default command;
