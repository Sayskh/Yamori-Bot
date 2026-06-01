import { Command } from '../../types/Command';
import { replaceVariables } from '../../utils/helpers';
import { getAdminConfig } from '../../core/configLoader';
const command: Command = {
    name: 'groupchat',
    aliases: ['gc'],
    description: 'Lock/Unlock group chat. Usage: .gc close / .gc open',
    usage: '<close/open>',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const { from, dataManager, pushname, groupName, prefix, botId, t } = context;
        if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: t('group_only') });

        const action = args[0]?.toLowerCase();

        if (!action || (action !== 'close' && action !== 'open')) {
            await sock.sendMessage(from, {
                text: t('gc_usage', { prefix }),
            }, { quoted: msg });
            return;
        }

        const isLock = action === 'close';
        const db = dataManager.db;
        const settings = await db.getGroupSettings(botId, from);

        try {
            if (isLock) {
                await sock.groupSettingUpdate(from, 'announcement');

                const adminCfg = getAdminConfig();

                const text = settings.lock
                    ? replaceVariables(settings.lock, { name: pushname, groupName })
                    : replaceVariables(adminCfg.lock_template, { name: pushname, groupName });

                await sock.sendMessage(from, { text });
            } else {
                await sock.groupSettingUpdate(from, 'not_announcement');

                const adminCfg = getAdminConfig();

                const text = settings.unlock
                    ? replaceVariables(settings.unlock, { name: pushname, groupName })
                    : replaceVariables(adminCfg.unlock_template, { name: pushname, groupName });

                await sock.sendMessage(from, { text });
            }
        } catch (error) {
            await sock.sendMessage(from, { text: t('fail_bot_admin') });
        }
    }
};

export default command;
