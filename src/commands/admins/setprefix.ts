import { Command } from '../../types/Command';
import config from '../../config';

const command: Command = {
    name: 'setprefix',
    description: 'Ubah prefix bot untuk chat ini',
    usage: '<prefix baru> / reset',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const from = msg.key.remoteJid!;
        const { dataManager, botId } = context;

        const currentPrefix = await dataManager.getPrefix(botId, from, config.prefix);
        const isDefault = currentPrefix === config.prefix;

        if (args.length === 0) {
            return sock.sendMessage(from, {
                text: `Current prefix: ${currentPrefix} (${isDefault ? 'default' : 'custom'})\n\n` +
                    `Usage: ${currentPrefix}setprefix <new_prefix>\n` +
                    `Reset: ${currentPrefix}setprefix reset`
            });
        }

        const newPrefix = args[0].toLowerCase();

        if (newPrefix === 'reset') {
            if (isDefault) return sock.sendMessage(from, { text: `Already using default prefix: ${config.prefix}` });
            await dataManager.deletePrefix(botId, from);
            return sock.sendMessage(from, { text: `Prefix reset to default: ${config.prefix}` });
        }

        if (newPrefix.length > 3) return sock.sendMessage(from, { text: 'Prefix must be 3 characters or less.' });
        if (newPrefix === currentPrefix) return sock.sendMessage(from, { text: `Already using prefix: ${currentPrefix}` });

        await dataManager.setPrefix(botId, from, newPrefix);
        await sock.sendMessage(from, { text: `Prefix changed to: ${newPrefix}` });
    }
};

export default command;
