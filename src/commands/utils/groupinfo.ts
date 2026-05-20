import { Command } from '../../types/Command';
import { getAdminConfig } from '../../core/configLoader';
import { replaceVariables } from '../../utils/helpers';

const command: Command = {
    name: 'groupinfo',
    aliases: ['ginfo'],
    description: 'Lihat informasi grup',
    async execute(sock, msg, args, context) {
        const from = msg.key.remoteJid!;
        if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya bisa digunakan di grup.' });

        try {
            const groupMetadata = await sock.groupMetadata(from);

            const groupName = groupMetadata.subject;
            const groupDesc = groupMetadata.desc || 'Tidak ada deskripsi';
            const participants = groupMetadata.participants;
            const totalMembers = participants.length;

            const admins = participants.filter((p: any) => p.admin === 'admin' || p.admin === 'superadmin');
            const adminList = admins.map((admin: any) => `• @${admin.id.split('@')[0]}`).join('\n');

            const creationDate = groupMetadata.creation
                ? new Date(groupMetadata.creation * 1000).toLocaleDateString('id-ID', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })
                : 'Unknown';

            const announce = groupMetadata.announce ? 'Hanya Admin' : 'Semua Member';
            const restrict = groupMetadata.restrict ? 'Hanya Admin' : 'Semua Member';

            const adminCfg = getAdminConfig();

            const infoText = replaceVariables(adminCfg.groupinfo_template, {
                groupName,
                desc: groupDesc,
                totalMembers,
                adminCount: admins.length,
                adminList,
                announce,
                restrict,
                creationDate,
                groupId: from.split('@')[0]
            });

            await sock.sendMessage(from, {
                text: infoText,
                mentions: admins.map((a: any) => a.id)
            }, { quoted: msg });

        } catch (error) {
            await sock.sendMessage(from, { text: 'Gagal mengambil informasi grup.' }, { quoted: msg });
        }
    }
};

export default command;
