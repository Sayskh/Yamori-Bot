import { Command } from '../../types/Command';

const command: Command = {
    name: 'goodbye',
    description: 'Menghidupkan/mematikan fitur pesan member keluar',
    usage: 'on / off',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId } = context;
        if (!args[0]) {
            const settings = await dataManager.db.getGroupSettings(botId, from);
            const status = settings.goodbyeEnabled ? 'aktif' : 'nonaktif';
            return sock.sendMessage(from, {
                text: `*Fitur Goodbye*\n\nStatus saat ini: *${status}*\n\nGunakan:\n• *${prefix}goodbye on* — Mengaktifkan goodbye\n• *${prefix}goodbye off* — Mematikan goodbye`
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(args[0].toLowerCase())) {
            return sock.sendMessage(from, { text: `Format salah.\nGunakan: ${prefix}goodbye on / off` }, { quoted: msg });
        }

        const isEnabled = args[0].toLowerCase() === 'on';
        await dataManager.db.toggleGoodbye(botId, from, isEnabled);



        await sock.sendMessage(from, { text: `Fitur Goodbye berhasil di-${isEnabled ? 'aktifkan' : 'matikan'}.` }, { quoted: msg });
    },
};

export default command;
