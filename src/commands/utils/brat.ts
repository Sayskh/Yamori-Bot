import { promises as fs } from 'fs';
import * as path from 'path';
import { writeExif } from '../../core/exif';
import { Command } from '../../types/Command';
import { imageToWebp } from '../../utils/converter';
import log from '../../utils/logger';

const TEMP_DIR = path.resolve(__dirname, '../../../tmp');

const ensureTempDir = async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => { });
};

const getTempFilename = (ext: string) => path.join(TEMP_DIR, `media_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`);

const deleteFiles = async (files: string[]) => {
    await Promise.all(files.map(f => fs.unlink(f).catch(() => { })));
};

const command: Command = {
    name: 'brat',
    aliases: ['tts', 'ttp'],
    description: 'Buat stiker teks ala brat',
    category: 'Utils',

    async execute(sock, msg, args, context) {
        const from = msg.key.remoteJid!;
        const senderNumber = (msg.key.participant || msg.key.remoteJid || '').split('@')[0];
        const senderName = context?.pushname || msg.pushName || senderNumber || 'User';
        
        // Simple parser for --bg and --color
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
            return sock.sendMessage(from, { text: 'Silakan masukkan teksnya! Contoh: *!brat Halo semuanya* atau *!brat Halo --bg #ff0000 --color #ffffff*' }, { quoted: msg });
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
            await sock.sendMessage(from, { text: 'Yah, gagal bikin stiker teksnya :( Coba lagi nanti ya (Mungkin server apinya lagi sibuk).' }, { quoted: msg });
        } finally {
            await deleteFiles(createdFiles);
        }
    }
};

export default command;
