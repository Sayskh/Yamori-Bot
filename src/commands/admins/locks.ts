import { Command } from '../../types/Command';
import { replaceVariables } from '../../utils/helpers';

const command: Command = {
    name: 'groupchat',
    aliases: ['gc'],
    description: 'Lock/Unlock group chat. Gunakan: .gc close / .gc open',
    usage: '<close/open>',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const { from, dataManager, pushname, groupName, prefix, botId } = context;
        if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: '⚠️ Perintah ini hanya bisa digunakan di grup.' });

        const action = args[0]?.toLowerCase();

        if (!action || (action !== 'close' && action !== 'open')) {
            await sock.sendMessage(from, {
                text: `⚠️ Gunakan:\n• *${prefix}gc close* — Kunci grup\n• *${prefix}gc open* — Buka grup`,
            }, { quoted: msg });
            return;
        }

        const isLock = action === 'close';
        const db = dataManager.db;
        const settings = await db.getGroupSettings(botId, from);

        try {
            if (isLock) {
                await sock.groupSettingUpdate(from, 'announcement');

                const { getAdminConfig } = require('../../core/configLoader');
                const adminCfg = getAdminConfig();

                const text = settings.lock
                    ? replaceVariables(settings.lock, { name: pushname, groupName })
                    : replaceVariables(adminCfg.lock_template, { name: pushname, groupName });

                await sock.sendMessage(from, { text });
            } else {
                await sock.groupSettingUpdate(from, 'not_announcement');

                const { getAdminConfig } = require('../../core/configLoader');
                const adminCfg = getAdminConfig();

                const text = settings.unlock
                    ? replaceVariables(settings.unlock, { name: pushname, groupName })
                    : replaceVariables(adminCfg.unlock_template, { name: pushname, groupName });

                await sock.sendMessage(from, { text });
            }
        } catch (error) {
            await sock.sendMessage(from, { text: '❌ Gagal mengubah pengaturan. Bot perlu hak admin.' });
        }
    }
};

export default command;
