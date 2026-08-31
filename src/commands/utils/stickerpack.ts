import { Command } from '../../types/Command';
import { downloadMediaMessage, WAMessage, WASocket, proto } from 'baileys';
import { promises as fs } from 'fs';
import { stickerStorage, MAX_STICKERS_PER_PACK } from '../../services/stickerStorage';
import { stickerPackService, isAnimatedWebP } from '../../services/stickerPackService';
import { imageToWebp, videoToWebp } from '../../utils/converter';
import { ensureTempDir, getTempFilename, deleteFiles } from '../../utils/tempFiles';
import { storeManager } from '../../core/storeManager';
import log from '../../utils/logger';
import crypto from 'crypto';

const tlog = log.child({ module: 'stickerpackCommand' });

function unwrapMessageContent(message: any): any {
    let current = message;
    while (current) {
        if (current.ephemeralMessage?.message) { current = current.ephemeralMessage.message; continue; }
        if (current.viewOnceMessage?.message) { current = current.viewOnceMessage.message; continue; }
        if (current.viewOnceMessageV2?.message) { current = current.viewOnceMessageV2.message; continue; }
        if (current.viewOnceMessageV2Extension?.message) { current = current.viewOnceMessageV2Extension.message; continue; }
        break;
    }
    return current;
}

interface QuotedMedia {
    targetMsg: WAMessage;
    type: 'sticker' | 'image' | 'video';
    stickerMessage?: any;
}

/**
 * Detect the type of media in a message (sticker, image, or video).
 */
function getQuotedMedia(msg: WAMessage): QuotedMedia | null {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    // Check direct message content (image/video sent with caption)
    const directContent = unwrapMessageContent(msg.message);
    if (directContent?.imageMessage) return { targetMsg: msg, type: 'image' };
    if (directContent?.videoMessage) return { targetMsg: msg, type: 'video' };
    if (directContent?.stickerMessage) return { targetMsg: msg, type: 'sticker', stickerMessage: directContent.stickerMessage };

    if (!ctx?.quotedMessage) return null;

    const unwrapped = unwrapMessageContent(ctx.quotedMessage);
    if (!unwrapped) return null;

    const remoteJid = msg.key.remoteJid || '';
    const stanzaId = ctx.stanzaId || '';
    const targetMsg = {
        key: { remoteJid, id: stanzaId, participant: ctx.participant || msg.key.participant || '', fromMe: false },
        message: ctx.quotedMessage,
    } as WAMessage;

    if (unwrapped.stickerMessage) return { targetMsg, type: 'sticker', stickerMessage: unwrapped.stickerMessage };
    if (unwrapped.imageMessage) return { targetMsg, type: 'image' };
    if (unwrapped.videoMessage) return { targetMsg, type: 'video' };

    return null;
}

async function downloadMedia(sock: WASocket, target: WAMessage): Promise<Buffer> {
    const stream = await downloadMediaMessage(target, 'buffer', {}, {
        reuploadRequest: (message: any) => sock.updateMediaMessage(message),
    } as any);
    return stream as Buffer;
}

/**
 * Convert an image or video buffer to a WebP sticker buffer via ffmpeg.
 */
async function convertMediaToWebp(buffer: Buffer, isImage: boolean): Promise<{ webpBuffer: Buffer; isAnimated: boolean }> {
    await ensureTempDir();
    const ext = isImage ? 'jpg' : 'mp4';
    const tempInput = getTempFilename(ext);
    const tempOutput = getTempFilename('webp');

    try {
        await fs.writeFile(tempInput, buffer);

        if (isImage) {
            await imageToWebp(tempInput, tempOutput);
        } else {
            await videoToWebp(tempInput, tempOutput);
        }

        const webpBuffer = await fs.readFile(tempOutput);
        return { webpBuffer, isAnimated: !isImage };
    } finally {
        await deleteFiles([tempInput, tempOutput]);
    }
}

/**
 * Scan message store for recent image/video messages from the same sender
 * within a time window (batch upload detection). WhatsApp sends multi-image
 * uploads as separate messages, usually within a few seconds of each other.
 * Only the first/last image gets the caption; the rest are captionless.
 */
function findBatchMediaMessages(
    sock: WASocket,
    jid: string,
    senderJid: string,
    currentMsgId: string,
    windowMs: number = 15000
): WAMessage[] {
    const results: WAMessage[] = [];

    for (const store of (storeManager as any).stores.values()) {
        if (!store.isBoundTo(sock)) continue;
        const list = store.messages.get(jid) as proto.IWebMessageInfo[] | undefined;
        if (!list) continue;

        for (const storedMsg of list) {
            // Skip the current message (already being processed)
            if (storedMsg.key?.id === currentMsgId) continue;

            // Must be from the same sender
            const msgSender = storedMsg.key?.participant || storedMsg.key?.remoteJid || '';
            if (msgSender !== senderJid) continue;

            // Must be recent (within time window)
            const msgTimestamp = Number(storedMsg.messageTimestamp || 0) * 1000;
            if (msgTimestamp <= 0) continue;
            const now = Date.now();
            if (now - msgTimestamp > windowMs) continue;

            // Must be an image or video WITHOUT a command caption
            const content = unwrapMessageContent(storedMsg.message);
            if (!content) continue;

            const hasImage = !!content.imageMessage;
            const hasVideo = !!content.videoMessage;
            if (!hasImage && !hasVideo) continue;

            // Skip if it has its own command caption (user explicitly typed something)
            const caption = content.imageMessage?.caption || content.videoMessage?.caption || '';
            if (caption.trim().length > 0) continue;

            results.push(storedMsg as WAMessage);
        }
    }

    return results;
}

/**
 * Process a single media item and add it to the pack.
 * Returns a result object or throws on critical errors.
 */
async function processAndAddMedia(
    sock: WASocket,
    targetMsg: WAMessage,
    mediaType: 'sticker' | 'image' | 'video',
    stickerMessage: any | undefined,
    botId: string,
    sender: string
): Promise<{ success: boolean; error?: string; isAnimated: boolean; isLottie: boolean }> {
    let buffer: Buffer;
    let isAnimated = false;
    let isLottie = false;

    if (mediaType === 'sticker') {
        buffer = await downloadMedia(sock, targetMsg);
        isLottie = Boolean(stickerMessage?.isLottie);
        isAnimated = Boolean(stickerMessage?.isAnimated) || isAnimatedWebP(buffer);
    } else {
        const rawBuffer = await downloadMedia(sock, targetMsg);
        const converted = await convertMediaToWebp(rawBuffer, mediaType === 'image');
        buffer = converted.webpBuffer;
        isAnimated = converted.isAnimated;
    }

    try {
        await stickerStorage.addSticker(botId, sender, buffer, { isAnimated, isLottie });
        return { success: true, isAnimated, isLottie };
    } catch (err: any) {
        return { success: false, error: err.message, isAnimated, isLottie };
    }
}

/**
 * Parse delete arguments supporting multiple indices, ranges (e.g. 1-5 or 1..5),
 * comma/space separators (e.g. 1, 2, 4), or 'all'.
 */
function parseDeleteTargets(args: string[], maxCount: number): number[] {
    const raw = args.join(' ').toLowerCase();
    if (raw === 'all' || raw === 'semua') {
        return Array.from({ length: maxCount }, (_, i) => i + 1);
    }

    const indices = new Set<number>();
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);

    for (const token of tokens) {
        const rangeMatch = token.match(/^(\d+)(?:-|(?:\.\.))(\d+)$/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            const min = Math.max(1, Math.min(start, end));
            const max = Math.min(maxCount, Math.max(start, end));
            for (let i = min; i <= max; i++) {
                indices.add(i);
            }
            continue;
        }

        const num = parseInt(token, 10);
        if (!isNaN(num) && num >= 1 && num <= maxCount) {
            indices.add(num);
        }
    }

    return Array.from(indices).sort((a, b) => a - b);
}

const command: Command = {
    name: 'stickerpack',
    aliases: ['sp', 'pack'],
    description: 'Collect stickers/images/videos and send as a WhatsApp sticker pack',
    usage: 'add | del | list | clear | send [name | author]',
    category: 'utils',

    async execute(sock, msg, args, context) {
        const { from, prefix, botId, pushname, t } = context;
        const sender = msg.key.participant || msg.key.remoteJid || '';

        const subCommand = (args[0] || '').toLowerCase();
        const subArgs = args.slice(1);

        try {
            // ── ADD ───────────────────────────────────────────────
            if (subCommand === 'add' || subCommand === '+') {
                const quoted = getQuotedMedia(msg);
                if (!quoted) {
                    return sock.sendMessage(from, { text: t('tspk_reply_sticker', { prefix }) }, { quoted: msg });
                }

                // Collect batch media from message store (multi-photo uploads)
                const batchMessages = (quoted.type === 'image' || quoted.type === 'video')
                    ? findBatchMediaMessages(sock, from, sender, msg.key.id || '')
                    : [];

                const allTargets: Array<{ targetMsg: WAMessage; type: 'sticker' | 'image' | 'video'; stickerMessage?: any }> = [
                    quoted,
                    ...batchMessages.map(bm => {
                        const content = unwrapMessageContent(bm.message);
                        const type: 'image' | 'video' = content?.imageMessage ? 'image' : 'video';
                        return { targetMsg: bm, type, stickerMessage: undefined };
                    }),
                ];

                let addedCount = 0;
                let skippedDuplicates = 0;
                let skippedErrors = 0;

                for (const target of allTargets) {
                    try {
                        const result = await processAndAddMedia(
                            sock, target.targetMsg, target.type, target.stickerMessage, botId, sender
                        );

                        if (result.success) {
                            addedCount++;
                        } else if (result.error === 'ALREADY_EXISTS') {
                            skippedDuplicates++;
                        } else if (result.error === 'PACK_FULL') {
                            break; // Stop processing, pack is full
                        } else if (result.error === 'STICKER_TOO_LARGE') {
                            skippedErrors++;
                        }
                    } catch (mediaErr) {
                        tlog.warn({ err: mediaErr }, 'Failed to process batch media item');
                        skippedErrors++;
                    }
                }

                if (addedCount === 0 && skippedDuplicates > 0) {
                    return sock.sendMessage(from, { text: t('tspk_already_exists') }, { quoted: msg });
                }

                if (addedCount === 0) {
                    const manifest = await stickerStorage.getManifest(botId, sender);
                    if (manifest.stickers.length >= MAX_STICKERS_PER_PACK) {
                        return sock.sendMessage(from, { text: t('tspk_full', { max: MAX_STICKERS_PER_PACK.toString() }) }, { quoted: msg });
                    }
                    return sock.sendMessage(from, { text: t('tspk_fail') }, { quoted: msg });
                }

                const manifest = await stickerStorage.getManifest(botId, sender);
                const total = manifest.stickers.length;

                let responseText: string;
                if (allTargets.length === 1) {
                    // Single media: show type label
                    const firstResult = allTargets[0];
                    const isLottie = firstResult.type === 'sticker' && firstResult.stickerMessage?.isLottie;
                    const isAnim = firstResult.type === 'video';
                    const typeLabel = isLottie ? 'Lottie' : isAnim ? t('tspk_type_animated') : t('tspk_type_static');
                    responseText = t('tspk_added', {
                        type: typeLabel,
                        count: total.toString(),
                        max: MAX_STICKERS_PER_PACK.toString(),
                    });
                } else {
                    // Batch: show count summary
                    responseText = t('tspk_batch_added', {
                        added: addedCount.toString(),
                        total: total.toString(),
                        max: MAX_STICKERS_PER_PACK.toString(),
                    });

                    if (skippedDuplicates > 0) {
                        responseText += `\n${t('tspk_batch_skipped_dup', { count: skippedDuplicates.toString() })}`;
                    }
                }

                return sock.sendMessage(from, { text: responseText }, { quoted: msg });
            }

            // ── DEL ───────────────────────────────────────────────
            if (subCommand === 'del' || subCommand === 'rm' || subCommand === '-') {
                const manifest = await stickerStorage.getManifest(botId, sender);
                if (manifest.stickers.length === 0) {
                    return sock.sendMessage(from, { text: t('tspk_empty', { prefix }) }, { quoted: msg });
                }

                const quoted = getQuotedMedia(msg);
                const targets: Array<string | number> = [];

                if (quoted?.type === 'sticker') {
                    const stickerBuffer = await downloadMedia(sock, quoted.targetMsg);
                    const sha = crypto.createHash('sha256').update(stickerBuffer).digest('hex');
                    targets.push(sha);
                }

                if (subArgs.length > 0) {
                    const parsedIndices = parseDeleteTargets(subArgs, manifest.stickers.length);
                    targets.push(...parsedIndices);
                }

                if (targets.length === 0) {
                    return sock.sendMessage(from, { text: t('tspk_del_usage', { prefix }) }, { quoted: msg });
                }

                const { removedCount, remainingCount } = await stickerStorage.removeStickers(botId, sender, targets);
                if (removedCount === 0) {
                    return sock.sendMessage(from, { text: t('tspk_not_found') }, { quoted: msg });
                }

                const responseText = removedCount === 1
                    ? t('tspk_removed', {
                        remaining: remainingCount.toString(),
                        max: MAX_STICKERS_PER_PACK.toString(),
                    })
                    : t('tspk_batch_removed', {
                        removed: removedCount.toString(),
                        remaining: remainingCount.toString(),
                        max: MAX_STICKERS_PER_PACK.toString(),
                    });

                return sock.sendMessage(from, { text: responseText }, { quoted: msg });
            }

            // ── LIST ──────────────────────────────────────────────
            if (subCommand === 'list' || subCommand === 'ls') {
                const manifest = await stickerStorage.getManifest(botId, sender);
                if (manifest.stickers.length === 0) {
                    return sock.sendMessage(from, { text: t('tspk_empty', { prefix }) }, { quoted: msg });
                }

                const animatedCount = manifest.stickers.filter((s) => s.isAnimated || s.isLottie).length;
                const staticCount = manifest.stickers.length - animatedCount;

                let listText = `${t('tspk_list_title')}\n`;
                listText += `\u2022 Total: ${manifest.stickers.length}/${MAX_STICKERS_PER_PACK}\n`;
                listText += `\u2022 ${t('tspk_type_static')}: ${staticCount}\n`;
                listText += `\u2022 ${t('tspk_type_animated')}: ${animatedCount}\n\n`;

                manifest.stickers.forEach((s, idx) => {
                    const label = s.isLottie ? 'Lottie' : s.isAnimated ? 'Animated' : 'Static';
                    const dateStr = new Date(s.addedAt).toLocaleDateString('id-ID');
                    listText += `${idx + 1}. [${label}] - ${dateStr}\n`;
                });

                listText += `\n${t('tspk_list_footer', { prefix })}`;
                return sock.sendMessage(from, { text: listText }, { quoted: msg });
            }

            // ── CLEAR ─────────────────────────────────────────────
            if (subCommand === 'clear' || subCommand === 'reset') {
                await stickerStorage.clearPack(botId, sender);
                return sock.sendMessage(from, { text: t('tspk_cleared') }, { quoted: msg });
            }

            // ── SEND (default) ────────────────────────────────────
            if (subCommand === 'send' || subCommand === '' || !['add', '+', 'del', 'rm', '-', 'list', 'ls', 'clear', 'reset'].includes(subCommand)) {
                const manifest = await stickerStorage.getManifest(botId, sender);
                if (manifest.stickers.length === 0) {
                    return sock.sendMessage(from, { text: t('tspk_empty', { prefix }) }, { quoted: msg });
                }

                let packName = manifest.packName || `${pushname || 'User'}'s Pack`;
                let publisher = manifest.publisher || `${pushname || 'User'}`;

                const rawArgs = subCommand === 'send' ? subArgs.join(' ') : args.join(' ');
                if (rawArgs.trim()) {
                    const parts = rawArgs.split('|');
                    if (parts[0]?.trim()) packName = parts[0].trim();
                    if (parts[1]?.trim()) publisher = parts[1].trim();
                }

                await sock.sendMessage(from, {
                    text: t('tspk_processing', { count: manifest.stickers.length.toString(), packName }),
                }, { quoted: msg });

                await stickerPackService.sendStickerPack(sock, from, sender, botId, {
                    packName,
                    publisher,
                    quotedMsg: msg,
                });
            }
        } catch (err: any) {
            tlog.error({ err, sender }, 'Error in stickerpack command');

            if (err.message === 'ALREADY_PROCESSING') {
                return sock.sendMessage(from, { text: t('tspk_already_processing') }, { quoted: msg });
            }

            return sock.sendMessage(from, { text: t('tspk_fail') }, { quoted: msg });
        }
    },
};

export default command;
