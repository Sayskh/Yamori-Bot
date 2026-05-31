import { Command } from '../../types/Command';

const command: Command = {
    name: 'welcome',
    description: 'Menghidupkan/mematikan fitur pesan sambutan',
    usage: 'on / off',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId } = context;
        if (!args[0]) {
            const settings = await dataManager.db.getGroupSettings(botId, from);
            const status = settings.welcomeEnabled ? 'aktif' : 'nonaktif';
            return sock.sendMessage(from, {
                text: `*Fitur Welcome*\n\nStatus saat ini: *${status}*\n\nGunakan:\n• *${prefix}welcome on* — Mengaktifkan welcome\n• *${prefix}welcome off* — Mematikan welcome`
            }, { quoted: msg });
        }

        if (!['on', 'off'].includes(args[0].toLowerCase())) {
            return sock.sendMessage(from, { text: `Format salah.\nGunakan: ${prefix}welcome on / off` }, { quoted: msg });
        }

        const isEnabled = args[0].toLowerCase() === 'on';
        await dataManager.db.toggleWelcome(botId, from, isEnabled);



        await sock.sendMessage(from, { text: `Fitur Welcome berhasil di-${isEnabled ? 'aktifkan' : 'matikan'}.` }, { quoted: msg });
    },
};

export default command;
