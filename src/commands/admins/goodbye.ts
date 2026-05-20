import { Command } from '../../types/Command';

const command: Command = {
    name: 'goodbye',
    description: 'Menghidupkan/mematikan fitur pesan member keluar',
    usage: 'on / off',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId } = context;
        if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
            return sock.sendMessage(from, { text: `Format salah.\nGunakan: ${prefix}goodbye on / off` }, { quoted: msg });
        }

        const isEnabled = args[0].toLowerCase() === 'on';
        await dataManager.db.toggleGoodbye(botId, from, isEnabled);

        console.log(`[DEBUG] Set Goodbye for Group ${from} to ${isEnabled} (Bot ID: ${botId})`);

        await sock.sendMessage(from, { text: `Fitur Goodbye berhasil di-${isEnabled ? 'aktifkan' : 'matikan'}.` }, { quoted: msg });
    },
};

export default command;
