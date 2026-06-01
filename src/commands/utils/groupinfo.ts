import { Command } from '../../types/Command';
import { getAdminConfig } from '../../core/configLoader';
import { replaceVariables } from '../../utils/helpers';

const command: Command = {
    name: 'groupinfo',
    aliases: ['ginfo'],
    description: 'View group information',
    async execute(sock, msg, args, context) {
        const { from, t } = context;
        if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: t('group_only') });

        try {
            const groupMetadata = await sock.groupMetadata(from);

            const groupName = groupMetadata.subject;
            const groupDesc = groupMetadata.desc || t('no_desc');
            const participants = groupMetadata.participants;
            const totalMembers = participants.length;

            const admins = participants.filter((p: any) => p.admin === 'admin' || p.admin === 'superadmin');
            const adminList = admins.map((admin: any) => `• @${admin.id.split('@')[0]}`).join('\n');

            const creationDate = groupMetadata.creation
                ? new Date(groupMetadata.creation * 1000).toLocaleDateString(context.lang === 'id' ? 'id-ID' : 'en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })
                : 'Unknown';

            const announce = groupMetadata.announce ? t('only_admin') : t('all_members');
            const restrict = groupMetadata.restrict ? t('only_admin') : t('all_members');

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
            await sock.sendMessage(from, { text: t('groupinfo_fail') }, { quoted: msg });
        }
    }
};

export default command;
