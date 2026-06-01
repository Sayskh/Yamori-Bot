import { Command } from '../../types/Command';
import config from '../../config';


const command: Command = {
    name: 'setprefix',
    description: 'Change bot prefix for this chat',
    usage: '<new prefix> / reset',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const from = msg.key.remoteJid!;
        const { dataManager, botId, t } = context;

        const currentPrefix = await dataManager.getPrefix(botId, from, config.prefix);
        const isDefault = currentPrefix === config.prefix;

        if (args.length === 0) {
            const statusLabel = isDefault ? 'default' : 'custom';
            return sock.sendMessage(from, {
                text: t('prefix_status', { current_prefix: t('current_prefix'), currentPrefix, statusLabel, prefix: currentPrefix })
            });
        }

        const newPrefix = args[0].toLowerCase();

        if (newPrefix === 'reset') {
            if (isDefault) return sock.sendMessage(from, { text: t('prefix_default') });
            await dataManager.deletePrefix(botId, from);
            return sock.sendMessage(from, { text: t('prefix_reset', { prefix: config.prefix }) });
        }

        if (newPrefix.length > 3) return sock.sendMessage(from, { text: t('prefix_limit') });
        if (newPrefix === currentPrefix) return sock.sendMessage(from, { text: t('prefix_already', { prefix: currentPrefix }) });

        await dataManager.setPrefix(botId, from, newPrefix);
        await sock.sendMessage(from, { text: t('prefix_changed', { prefix: newPrefix }) });
    }
};

export default command;
