import { WASocket } from 'baileys';
import dataManager from './dataManager';
import { replaceVariables } from '../utils/helpers';
import log from '../utils/logger';
import { getAdminConfig } from './configLoader';
import { getGroupMetadata } from './groupCache';
import fs from 'fs';
import { normalizeBotId } from '../utils/jid';

const glog = log.child({ module: 'group' });

export async function handleGroupParticipantsUpdate(sock: WASocket, update: { id: string; participants: string[]; action: 'add' | 'remove' | 'promote' | 'demote' }): Promise<void> {
    const { id, participants, action } = update;

    if (action !== 'add' && action !== 'remove') return;

    try {
        const botId = normalizeBotId(sock);

        const db = dataManager.db;
        const settings = await db.getGroupSettings(botId, id);

        glog.info({ action, botId, groupId: id, settingsFound: !!settings, welcomeEnabled: settings?.welcomeEnabled, goodbyeEnabled: settings?.goodbyeEnabled }, 'Group participant update triggered');

        const welcomeEnabled = settings ? settings.welcomeEnabled : false;
        const goodbyeEnabled = settings ? settings.goodbyeEnabled : false;

        let template: string | undefined;
        let imagePath: string | null = null;

        if (action === 'add' && welcomeEnabled) {
            template = settings?.welcome || getAdminConfig().welcome_template;
            imagePath = settings?.welcomeImage || null;
        } else if (action === 'remove' && goodbyeEnabled) {
            template = settings?.goodbye || getAdminConfig().goodbye_template;
            imagePath = settings?.goodbyeImage || null;
        }

        if (!template) return;

        let groupName = 'Group';
        try {
            const metadata = await getGroupMetadata(sock, id);
            groupName = metadata.subject || 'Group';
        } catch (e) {
            glog.warn({ groupId: id, err: e }, 'Failed to fetch group metadata for participant update, using fallback');
        }

        for (const participant of participants) {
            const pId = typeof participant === 'string' ? participant : ((participant as any)?.id || '');
            if (!pId) continue;
            const userNumber = pId.split('@')[0];
            const text = replaceVariables(template, {
                user: `@${userNumber}`,
                groupName: groupName,
            });

            if (imagePath && fs.existsSync(imagePath)) {
                const ext = imagePath.split('.').pop()?.toLowerCase();
                if (ext === 'mp4' || ext === 'mkv' || ext === 'gif') {
                    await sock.sendMessage(id, {
                        video: { url: imagePath },
                        gifPlayback: ext === 'gif',
                        caption: text,
                        mentions: [pId],
                    });
                } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
                    await sock.sendMessage(id, {
                        image: { url: imagePath },
                        caption: text,
                        mentions: [pId],
                    });
                } else {
                    await sock.sendMessage(id, {
                        document: { url: imagePath },
                        mimetype: 'application/octet-stream',
                        fileName: `attachment.${ext || 'bin'}`,
                        caption: text,
                        mentions: [pId],
                    });
                }
            } else {
                await sock.sendMessage(id, {
                    text,
                    mentions: [pId],
                });
            }
        }
    } catch (err) {
        glog.error({ err, group: id }, 'Failed to handle participant update');
    }
}

