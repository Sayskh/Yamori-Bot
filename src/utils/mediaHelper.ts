import { WAMessage, downloadMediaMessage } from 'baileys';
import fs from 'fs';
import path from 'path';
import config from '../config';
import log from './logger';

const mlog = log.child({ module: 'media' });

function getMediaExtension(msg: WAMessage): string {
    const m = msg.message;
    if (!m) return 'bin';

    if (m.imageMessage) {
        const mime = m.imageMessage.mimetype || 'image/jpeg';
        if (mime.includes('png')) return 'png';
        if (mime.includes('webp')) return 'webp';
        return 'jpg';
    }
    if (m.videoMessage) return 'mp4';
    if (m.documentMessage) {
        const ext = path.extname(m.documentMessage.fileName || '').slice(1);
        return ext || 'bin';
    }
    return 'bin';
}

export async function saveMediaToFile(
    msg: WAMessage,
    groupId: string,
    itemName: string
): Promise<string | null> {
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const mediaDir = path.join(config.mediaPath, groupId.replace(/[^a-zA-Z0-9]/g, '_'));

        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir, { recursive: true });
        }

        const ext = getMediaExtension(msg);
        const filename = `${itemName.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
        const filePath = path.join(mediaDir, filename);

        fs.writeFileSync(filePath, buffer as Buffer);
        return filePath;
    } catch (error) {
        mlog.error({ err: error }, 'Failed to save media');
        return null;
    }
}
