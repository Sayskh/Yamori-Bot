import { Command } from '../../types/Command';


const command: Command = {
    name: 'welcome',
    description: 'Toggle welcome message feature',
    usage: 'on / off',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId, t } = context;
        if (!args[0]) {
            const settings = await dataManager.db.getGroupSettings(botId, from);
            const status = settings.welcomeEnabled ? t('success') : t('failed');
            return sock.sendMessage(from, {
                text: t('welcome_status', { status, prefix })
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(args[0].toLowerCase())) {
            return sock.sendMessage(from, { text: t('invalid_usage') }, { quoted: msg });
        }

        const isEnabled = args[0].toLowerCase() === 'on';
        await dataManager.db.toggleWelcome(botId, from, isEnabled);

        await sock.sendMessage(from, { text: t(isEnabled ? 'welcome_enabled' : 'welcome_disabled') }, { quoted: msg });
    },
};

export default command;
