import { promises as fs } from 'fs';
import { writeExif } from '../../core/exif';
import { Command } from '../../types/Command';
import { imageToWebp } from '../../utils/converter';
import log from '../../utils/logger';
import { ensureTempDir, getTempFilename, deleteFiles } from '../../utils/tempFiles';

const command: Command = {
    name: 'brat',
    aliases: ['tts', 'ttp'],
    description: 'Create brat-style text sticker',
    category: 'Utils',

    async execute(sock, msg, args, context) {
        const from = msg.key.remoteJid!;
        const senderNumber = (msg.key.participant || msg.key.remoteJid || '').split('@')[0];
        const senderName = context?.pushname || msg.pushName || senderNumber || 'User';
        const t = context.t;
        
        let text = '';
        let background = '';
        let color = '';
        
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--bg' && args[i + 1]) {
                background = args[++i];
            } else if (args[i] === '--color' && args[i + 1]) {
                color = args[++i];
            } else {
                text += (text ? ' ' : '') + args[i];
            }
        }

        if (!text) {
            return sock.sendMessage(from, { text: t('brat_usage') }, { quoted: msg });
        }

        await ensureTempDir();

        let url = `https://aqul-brat.hf.space/api/brat?text=${encodeURIComponent(text)}`;
        if (background) url += `&background=${encodeURIComponent(background)}`;
        if (color) url += `&color=${encodeURIComponent(color)}`;
        
        const tempImage = getTempFilename('png');
        const tempWebp = getTempFilename('webp');
        const createdFiles = [tempImage, tempWebp];

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            await fs.writeFile(tempImage, buffer);
            await imageToWebp(tempImage, tempWebp);

            const stickerBuffer = await fs.readFile(tempWebp);
            const packname = 'Sticker By';
            const author = `${senderName}`;
            const finalSticker = await writeExif(stickerBuffer, { packname, author });

            await sock.sendMessage(from, { sticker: finalSticker }, { quoted: msg });

        } catch (error: any) {
            log.error({ err: error }, 'Brat command failed');
            await sock.sendMessage(from, { text: t('brat_server_busy', { fail_process: t('fail_process') }) }, { quoted: msg });
        } finally {
            await deleteFiles(createdFiles);
        }
    }
};

export default command;
