import { Command } from '../../types/Command';

const command: Command = {
    name: 'antilink',
    description: 'Atur mode antilink (kick/delete/off)',
    usage: 'kick / delete / off',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId } = context;

        const mode = args[0]?.toLowerCase();

        if (!['kick', 'delete', 'off'].includes(mode)) {
            const settings = await dataManager.db.getGroupSettings(botId, from);
            return sock.sendMessage(from, {
                text: `*Antilink Mode*\n\n`
                    + `Pilih mode:\n`
                    + `• ${prefix}antilink kick (Hapus link & Kick)\n`
                    + `• ${prefix}antilink delete (Hapus link saja)\n`
                    + `• ${prefix}antilink off (Matikan)\n\n`
                    + `Saat ini: *${settings.antilinkMode}*`
            }, { quoted: msg });
        }

        const dbMode = mode === 'delete' ? 'delete_only' : mode;
        await dataManager.db.setAntilinkMode(botId, from, dbMode);

        await sock.sendMessage(from, { text: `Antilink berhasil diatur ke mode: *${mode}*.` }, { quoted: msg });
    },
};

export default command;
