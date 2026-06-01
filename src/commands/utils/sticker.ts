import { promises as fs } from 'fs';
import { downloadMediaMessage, WAMessage, WASocket } from 'baileys';
import { writeExif } from '../../core/exif';
import { Command } from '../../types/Command';
import { imageToWebp, mediaToMp4, videoToWebp, webpToImage, webpToVideo } from '../../utils/converter';
import log from '../../utils/logger';
import WebP from 'node-webpmux';
import { storeManager } from '../../core/storeManager';
import { ensureTempDir, getTempFilename, deleteFiles } from '../../utils/tempFiles';
import { t } from '../../utils/lang';

function unwrapMessageContent(message: any): any {
    let current = message;

    while (current) {
        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            continue;
        }
        if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
            continue;
        }
        if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
            continue;
        }
        if (current.viewOnceMessageV2Extension?.message) {
            current = current.viewOnceMessageV2Extension.message;
            continue;
        }
        break;
    }

    return current;
}

function getQuotedAsMessage(sock: WASocket, msg: WAMessage): WAMessage | null {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;

    const remoteJid = msg.key.remoteJid || '';
    const stanzaId = ctx.stanzaId || '';

    if (remoteJid && stanzaId) {
        const original = storeManager.findMessageBySocket(sock, remoteJid, stanzaId);
        if (original?.message) return original as unknown as WAMessage;
    }

    return {
        key: {
            remoteJid,
            id: stanzaId,
            participant: ctx.participant || msg.key.participant || '',
            fromMe: false,
        },
        message: ctx.quotedMessage,
    } as WAMessage;
}

function getTargetMessage(sock: WASocket, msg: WAMessage): WAMessage | null {
    if (!msg.message) return null;
    return getQuotedAsMessage(sock, msg) || msg;
}

function detectBufferKind(buffer: Buffer): 'webp' | 'png' | 'jpg' | 'gif' | 'mp4' | 'unknown' {
    if (buffer.length >= 12) {
        const riff = buffer.subarray(0, 4).toString('ascii');
        const webp = buffer.subarray(8, 12).toString('ascii');
        if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
    }

    if (buffer.length >= 8) {
        const pngHex = buffer.subarray(0, 8).toString('hex');
        if (pngHex === '89504e470d0a1a0a') return 'png';
    }

    if (buffer.length >= 3) {
        const jpgHex = buffer.subarray(0, 3).toString('hex');
        if (jpgHex === 'ffd8ff') return 'jpg';
    }

    if (buffer.length >= 4) {
        const gif = buffer.subarray(0, 4).toString('ascii');
        if (gif === 'GIF8') return 'gif';
    }

    if (buffer.length >= 8) {
        const ftyp = buffer.subarray(4, 8).toString('ascii');
        if (ftyp === 'ftyp') return 'mp4';
    }

    return 'unknown';
}

async function downloadMedia(sock: WASocket, target: WAMessage): Promise<Buffer> {
    const stream = await downloadMediaMessage(
        target,
        'buffer',
        {},
        {
            reuploadRequest: (message: any) => sock.updateMediaMessage(message),
        } as any
    );

    return stream as Buffer;
}

const command: Command = {
    name: 'sticker',
    aliases: ['s', 'stiker'],
    description: 'Convert image/video to sticker and vice versa',

    async execute(sock, msg, args, context) {
        const from = msg.key.remoteJid!;
        await ensureTempDir();

        const senderNumber = (msg.key.participant || msg.key.remoteJid || '').split('@')[0];
        const senderName = context?.pushname || msg.pushName || senderNumber || 'User';

        let packname = 'Sticker By';
        let author = `${senderName}`;

        const joinedArgs = args.join(' ');
        if (joinedArgs) {
            const split = joinedArgs.split('|');
            packname = split[0].trim() || packname;
            author = split[1]?.trim() || author;
        }

        const target = getTargetMessage(sock, msg);
        if (!target) {
            return sock.sendMessage(from, { text: t('no_media') }, { quoted: msg });
        }

        const normalized = unwrapMessageContent(target.message);
        const hasImage = !!normalized?.imageMessage;
        const hasVideo = !!normalized?.videoMessage;
        const hasSticker = !!normalized?.stickerMessage;
        const isAnimatedSticker = !!normalized?.stickerMessage?.isAnimated;

        if (!hasImage && !hasVideo && !hasSticker) {
            return sock.sendMessage(from, { text: t('no_media') }, { quoted: msg });
        }

        try {
            if (hasSticker) {
                await processStickerToMedia(sock, msg, from, target, isAnimatedSticker);
            } else {
                await processMediaToSticker(sock, msg, from, target, hasImage, packname, author);
            }
        } catch (error: any) {
            log.error({ err: error }, 'Sticker command failed');
            await sock.sendMessage(from, { text: t('fail_process') }, { quoted: msg });
        }
    }
};

async function processStickerToMedia(
    sock: WASocket,
    replyMsg: WAMessage,
    from: string,
    targetMsg: WAMessage,
    isAnimatedHint: boolean
) {
    const mediaBuffer = await downloadMedia(sock, targetMsg);
    const detectedType = detectBufferKind(mediaBuffer);

    if (detectedType !== 'webp') {
        log.warn({ detectedType, size: mediaBuffer.length, isAnimatedHint }, 'Sticker media is not WebP, attempting fallback');

        if (isAnimatedHint || detectedType === 'gif' || detectedType === 'mp4') {
            const tempInput = getTempFilename(detectedType === 'unknown' ? 'bin' : detectedType);
            const tempVideo = getTempFilename('mp4');

            try {
                await fs.writeFile(tempInput, mediaBuffer);
                await mediaToMp4(tempInput, tempVideo);
                const videoBuffer = await fs.readFile(tempVideo);
                await sock.sendMessage(from, { video: videoBuffer, gifPlayback: true }, { quoted: replyMsg });
                return;
            } catch (mp4Error) {
                log.warn({ err: mp4Error }, 'Unknown sticker payload failed to convert to mp4');
            } finally {
                await deleteFiles([tempInput, tempVideo]);
            }
        }

        if (detectedType === 'png' || detectedType === 'jpg') {
            await sock.sendMessage(from, { image: mediaBuffer }, { quoted: replyMsg });
            return;
        }

        if (detectedType === 'gif' || detectedType === 'mp4') {
            await sock.sendMessage(from, { video: mediaBuffer }, { quoted: replyMsg });
            return;
        }

        await sock.sendMessage(
            from,
            { document: mediaBuffer, mimetype: 'application/octet-stream', fileName: 'sticker-media.bin' },
            { quoted: replyMsg }
        );
        return;
    }

    const tempWebp = getTempFilename('webp');
    const createdFiles = [tempWebp];

    try {
        await fs.writeFile(tempWebp, mediaBuffer);
        let hasAnimation = isAnimatedHint;

        try {
            const img = new WebP.Image();
            await img.load(tempWebp);
            hasAnimation = hasAnimation || !!img.hasAnim;
        } catch (parseError) {
            log.warn({ err: parseError, isAnimatedHint }, 'Failed to parse WebP metadata');
        }

        if (hasAnimation) {
            const tempVideo = getTempFilename('mp4');
            createdFiles.push(tempVideo);
            try {
                await webpToVideo(tempWebp, tempVideo);
                const videoBuffer = await fs.readFile(tempVideo);
                await sock.sendMessage(from, { video: videoBuffer, gifPlayback: true }, { quoted: replyMsg });
            } catch (videoError) {
                log.warn({ err: videoError }, 'WebP to video failed, sending raw webp as fallback');
                await sock.sendMessage(
                    from,
                    {
                        document: mediaBuffer,
                        mimetype: 'image/webp',
                        fileName: 'sticker.webp',
                        caption: t('fail_process') + '. WebP.'
                    },
                    { quoted: replyMsg }
                );
            }
            return;
        }

        const tempPng = getTempFilename('png');
        createdFiles.push(tempPng);
        await webpToImage(tempWebp, tempPng);
        const imageBuffer = await fs.readFile(tempPng);
        await sock.sendMessage(from, { image: imageBuffer }, { quoted: replyMsg });
    } finally {
        await deleteFiles(createdFiles);
    }
}

async function processMediaToSticker(
    sock: WASocket,
    replyMsg: WAMessage,
    from: string,
    targetMsg: WAMessage,
    isImage: boolean,
    packname: string,
    author: string
) {
    const mediaBuffer = await downloadMedia(sock, targetMsg);
    const ext = isImage ? 'jpg' : 'mp4';
    const tempInput = getTempFilename(ext);
    const tempOutput = getTempFilename('webp');
    const createdFiles = [tempInput, tempOutput];

    try {
        await fs.writeFile(tempInput, mediaBuffer);

        if (isImage) {
            await imageToWebp(tempInput, tempOutput);
        } else {
            await videoToWebp(tempInput, tempOutput);
        }

        const stickerBuffer = await fs.readFile(tempOutput);
        const finalSticker = await writeExif(stickerBuffer, { packname, author });
        await sock.sendMessage(from, { sticker: finalSticker }, { quoted: replyMsg });
    } finally {
        await deleteFiles(createdFiles);
    }
}

export default command;
