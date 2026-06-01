import { Command } from '../../types/Command';

const command: Command = {
    name: 'antilink',
    description: 'Configure antilink mode (kick/delete/off)',
    usage: 'kick / delete / off',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId, t } = context;

        const mode = args[0]?.toLowerCase();

        if (!['kick', 'delete', 'off'].includes(mode)) {
            const settings = await dataManager.db.getGroupSettings(botId, from);
            return sock.sendMessage(from, {
                text: t('antilink_usage', { prefix, current: settings.antilinkMode })
            }, { quoted: msg });
        }

        const dbMode = mode === 'delete' ? 'delete_only' : mode;
        await dataManager.db.setAntilinkMode(botId, from, dbMode);

        await sock.sendMessage(from, { text: t('antilink_success', { mode }) }, { quoted: msg });
    },
};

export default command;
