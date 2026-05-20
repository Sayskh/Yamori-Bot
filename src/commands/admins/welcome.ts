import { Command } from '../../types/Command';

const command: Command = {
    name: 'welcome',
    description: 'Menghidupkan/mematikan fitur pesan sambutan',
    usage: 'on / off',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId } = context;
        if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
            return sock.sendMessage(from, { text: `Format salah.\nGunakan: ${prefix}welcome on / off` }, { quoted: msg });
        }

        const isEnabled = args[0].toLowerCase() === 'on';
        await dataManager.db.toggleWelcome(botId, from, isEnabled);

        console.log(`[DEBUG] Set Welcome for Group ${from} to ${isEnabled} (Bot ID: ${botId})`);

        await sock.sendMessage(from, { text: `Fitur Welcome berhasil di-${isEnabled ? 'aktifkan' : 'matikan'}.` }, { quoted: msg });
    },
};

export default command;
