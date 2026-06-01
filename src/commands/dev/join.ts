import { Command } from '../../types/Command';
import { extractInviteCode } from '../../utils/validate';

const command: Command = {
    name: 'join',
    description: 'Bot joins group via invite link',
    usage: '<group link>',
    devOnly: true,

    async execute(sock, msg, args, context) {
        const { from, t } = context;

        const link = args[0];
        if (!link) {
            await sock.sendMessage(from, { text: t('join_usage') }, { quoted: msg });
            return;
        }

        const inviteCode = extractInviteCode(link);
        if (!inviteCode) {
            await sock.sendMessage(from, { text: t('join_invalid') }, { quoted: msg });
            return;
        }

        try {
            const groupId = await sock.groupAcceptInvite(inviteCode);
            await sock.sendMessage(from, { text: t('join_success', { id: groupId || '' }) }, { quoted: msg });
        } catch (err: any) {
            const message = err?.message?.includes('conflict')
                ? t('join_already')
                : t('join_fail', { err: err?.message || 'Unknown error' });
            await sock.sendMessage(from, { text: message }, { quoted: msg });
        }
    },
};

export default command;
