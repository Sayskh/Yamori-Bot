import { Command } from '../../types/Command';

const command: Command = {
    name: 'kick',
    aliases: ['tendang', 'keluarkan'],
    description: 'Mengeluarkan member dari grup',
    usage: '@tag / balas pesan',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from } = context;

        let targetJid: string | null = null;

        // Cek apakah me-mention seseorang
        const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentionedJidList.length > 0) {
            targetJid = mentionedJidList[0];
        }
        // Atau membalas pesan seseorang
        else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            targetJid = msg.message.extendedTextMessage.contextInfo.participant;
        }

        if (!targetJid) {
            return sock.sendMessage(from, { text: 'Tag at balas pesan orang yang ingin di-kick.' }, { quoted: msg });
        }

        try {
            await sock.groupParticipantsUpdate(from, [targetJid], 'remove');
            const { getAdminConfig } = require('../../core/configLoader');
            const template = getAdminConfig().kick_template;
            const text = template.replace(/@user/gi, `@${targetJid.split('@')[0]}`);

            await sock.sendMessage(from, { text, mentions: [targetJid] }, { quoted: msg });
        } catch (e) {
            await sock.sendMessage(from, { text: 'Gagal mengeluarkan member. Pastikan bot adalah admin grup.' }, { quoted: msg });
        }
    },
};

export default command;
