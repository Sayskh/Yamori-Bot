import { Command } from '../../types/Command';

const command: Command = {
    name: 'linkgc',
    aliases: ['linkgrup', 'grouplink'],
    description: 'Mendapatkan link invite dari grup',

    async execute(sock, msg, args, context) {
        const { from } = context;

        try {
            // Check if bot is admin
            const groupMetadata = await sock.groupMetadata(from);
            const botJid = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
            const isBotAdmin = groupMetadata.participants.find(p => p.id === botJid)?.admin !== null;

            if (!isBotAdmin) {
                return sock.sendMessage(from, { text: 'Bot harus menjadi admin grup untuk mengambil link.' }, { quoted: msg });
            }

            const code = await sock.groupInviteCode(from);
            const link = `https://chat.whatsapp.com/${code}`;

            await sock.sendMessage(from, { text: `*Link Grup:*\n\n${link}` });
        } catch (e) {
            await sock.sendMessage(from, { text: 'Gagal mengambil link grup. Pastikan bot adalah admin.' }, { quoted: msg });
        }
    },
};

export default command;
