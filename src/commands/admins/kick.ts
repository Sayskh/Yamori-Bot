import { Command } from '../../types/Command';
import { getAdminConfig } from '../../core/configLoader';

const command: Command = {
    name: 'kick',
    description: 'Kick member from group',
    usage: '@tag / reply to message',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, t } = context;

        let targetJid: string | null = null;

        // Check if someone is mentioned
        const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentionedJidList.length > 0) {
            targetJid = mentionedJidList[0];
        }
        // Or replying to someone's message
        else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            targetJid = msg.message.extendedTextMessage.contextInfo.participant;
        }

        if (!targetJid) {
            return sock.sendMessage(from, { text: t('kick_no_target') }, { quoted: msg });
        }

        try {
            await sock.groupParticipantsUpdate(from, [targetJid], 'remove');
            const template = getAdminConfig().kick_template;
            const text = template.replace(/@user/gi, `@${targetJid.split('@')[0]}`);

            await sock.sendMessage(from, { text, mentions: [targetJid] }, { quoted: msg });
        } catch (e) {
            await sock.sendMessage(from, { text: t('kick_fail') }, { quoted: msg });
        }
    },
};

export default command;
