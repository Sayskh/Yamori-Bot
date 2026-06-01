import { delay } from 'baileys';
import { getDevConfig } from '../../core/configLoader';
import { Command } from '../../types/Command';
import { replaceVariables } from '../../utils/helpers';
import log from '../../utils/logger';

const command: Command = {
    name: 'broadcast',
    aliases: ['bc'],
    description: 'Send message to all joined groups',
    usage: '<message>',
    devOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, t } = context;
        const broadcastMsg = args.join(' ').trim();

        if (!broadcastMsg) {
            await sock.sendMessage(from, {
                text: t('broadcast_usage', { prefix })
            }, { quoted: msg });
            return;
        }

        try {
            const participating = await sock.groupFetchAllParticipating();
            const groups = Object.values(participating || {}) as Array<{ id: string }>;

            if (groups.length === 0) {
                await sock.sendMessage(from, { text: t('broadcast_no_groups') }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, {
                text: t('broadcast_starting', { count: groups.length.toString() })
            }, { quoted: msg });

            const devCfg = getDevConfig();
            let success = 0;
            let failed = 0;

            for (const group of groups) {
                try {
                    await delay(1500);
                    const finalMsg = replaceVariables(devCfg.broadcast_template, { broadcastMsg });
                    await sock.sendMessage(group.id, { text: finalMsg });
                    success++;
                } catch (err) {
                    log.warn({ groupId: group.id, err }, 'Failed to broadcast to group');
                    failed++;
                }
            }

            await sock.sendMessage(from, {
                text: t('broadcast_done', { success: success.toString(), failed: failed.toString() }),
            });
        } catch (error) {
            log.error({ err: error }, 'Broadcast command error');
            await sock.sendMessage(from, { text: t('broadcast_error') }, { quoted: msg });
        }
    },
};

export default command;
