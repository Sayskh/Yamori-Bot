import { Command } from '../../types/Command';
import { getAdminConfig } from '../../core/configLoader';

const command: Command = {
    name: 'promote',
    description: 'Promote member to admin',
    usage: '@mention / reply',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const { from, t } = context;
        if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: t('group_only') });

        try {
            const groupMetadata = await sock.groupMetadata(from);
            const participants = groupMetadata.participants;

            let targetUser;

            if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length && msg.message.extendedTextMessage.contextInfo.mentionedJid.length > 0) {
                targetUser = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
            } else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
                targetUser = msg.message.extendedTextMessage.contextInfo.participant;
            } else {
                return sock.sendMessage(from, { text: t('mention_or_reply') });
            }

            const targetParticipant = participants.find((p: any) => p.id === targetUser);
            if (!targetParticipant) return sock.sendMessage(from, { text: t('user_not_found') });
            if (targetParticipant.admin) return sock.sendMessage(from, { text: t('user_already_admin') });

            await sock.groupParticipantsUpdate(from, [targetUser], 'promote');

            const template = getAdminConfig().promote_template;
            const text = template.replace(/@user/gi, `@${targetUser.split('@')[0]}`);

            await sock.sendMessage(from, {
                text,
                mentions: [targetUser]
            });

        } catch (error) {
            await sock.sendMessage(from, { text: t('fail_privileges') });
        }
    }
};

export default command;
