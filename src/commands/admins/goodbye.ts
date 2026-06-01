import { Command } from '../../types/Command';


const command: Command = {
    name: 'goodbye',
    description: 'Toggle goodbye message feature',
    usage: 'on / off',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId, t } = context;
        if (!args[0]) {
            const settings = await dataManager.db.getGroupSettings(botId, from);
            const status = settings.goodbyeEnabled ? t('success') : t('failed');
            return sock.sendMessage(from, {
                text: t('goodbye_status', { status, prefix })
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(args[0].toLowerCase())) {
            return sock.sendMessage(from, { text: t('invalid_usage') }, { quoted: msg });
        }

        const isEnabled = args[0].toLowerCase() === 'on';
        await dataManager.db.toggleGoodbye(botId, from, isEnabled);

        await sock.sendMessage(from, { text: t(isEnabled ? 'goodbye_enabled' : 'goodbye_disabled') }, { quoted: msg });
    },
};

export default command;
