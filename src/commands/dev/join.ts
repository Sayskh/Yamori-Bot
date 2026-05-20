import { Command } from '../../types/Command';
import { extractInviteCode } from '../../utils/validate';

const command: Command = {
    name: 'join',
    description: 'Bot bergabung ke grup via link undangan',
    usage: '<link grup>',
    devOnly: true,

    async execute(sock, msg, args, context) {
        const { from } = context;

        const link = args[0];
        if (!link) {
            await sock.sendMessage(from, { text: 'Kirim link grup.\n\nContoh: .join https://chat.whatsapp.com/xxxxx' }, { quoted: msg });
            return;
        }

        const inviteCode = extractInviteCode(link);
        if (!inviteCode) {
            await sock.sendMessage(from, { text: 'Link grup tidak valid.' }, { quoted: msg });
            return;
        }

        try {
            const groupId = await sock.groupAcceptInvite(inviteCode);
            await sock.sendMessage(from, { text: `Berhasil join ke grup: ${groupId}` }, { quoted: msg });
        } catch (err: any) {
            const message = err?.message?.includes('conflict')
                ? 'Bot sudah berada di grup tersebut.'
                : `Gagal join grup: ${err?.message || 'Unknown error'}`;
            await sock.sendMessage(from, { text: message }, { quoted: msg });
        }
    },
};

export default command;
