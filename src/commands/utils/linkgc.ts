import { Command } from '../../types/Command';
import { normalizeBotId } from '../../utils/jid';

const command: Command = {
    name: 'linkgc',
    aliases: ['linkgrup', 'grouplink'],
    description: 'Get group invite link',

    async execute(sock, msg, args, context) {
        const { from, t } = context;

        try {
            const groupMetadata = await sock.groupMetadata(from);
            const botJid = normalizeBotId(sock);
            const isBotAdmin = groupMetadata.participants.find(p => p.id === botJid)?.admin !== null;

            if (!isBotAdmin) {
                return sock.sendMessage(from, { text: t('linkgc_not_admin') }, { quoted: msg });
            }

            const code = await sock.groupInviteCode(from);
            const link = `https://chat.whatsapp.com/${code}`;

            await sock.sendMessage(from, { text: t('linkgc_success', { link }) });
        } catch (e) {
            await sock.sendMessage(from, { text: t('linkgc_fail') }, { quoted: msg });
        }
    },
};

export default command;
