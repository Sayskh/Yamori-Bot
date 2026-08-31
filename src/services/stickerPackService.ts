import crypto from 'crypto';
import https from 'https';
import JSZip from 'jszip';
import sharp from 'sharp';
import { WASocket } from 'baileys';
import { stickerStorage, StickerItem } from './stickerStorage';
import log from '../utils/logger';

const splog = log.child({ module: 'stickerPackService' });

function sha256(buffer: Buffer): Buffer {
    return crypto.createHash('sha256').update(buffer).digest();
}

function toB64Url(buffer: Buffer): string {
    return buffer
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

export function isWebP(buffer: Buffer): boolean {
    return (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
    );
}

export function isAnimatedWebP(buffer: Buffer): boolean {
    if (!isWebP(buffer)) return false;

    let offset = 12;
    while (offset < buffer.length - 8) {
        const chunk = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);

        if (chunk === 'VP8X' && (buffer[offset + 8] & 0x02)) return true;
        if (chunk === 'ANIM' || chunk === 'ANMF') return true;

        offset += 8 + size + (size % 2);
    }

    return false;
}

export async function makeTrayWebp(buffer: Buffer): Promise<Buffer> {
    return await sharp(buffer, { animated: false })
        .resize(252, 252, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer();
}

export async function makeBlankTrayWebp(): Promise<Buffer> {
    return await sharp({
        create: {
            width: 252,
            height: 252,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .webp()
        .toBuffer();
}

export async function makeThumbnailJpeg(buffer: Buffer): Promise<Buffer> {
    return await sharp(buffer)
        .resize(252, 252, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toBuffer();
}

interface UploadOptions {
    hkdf: string;
    mediaPath: string;
    mediaKey?: Buffer;
}

interface UploadResult {
    mediaKey: Buffer;
    fileLength: number;
    fileSha256: Buffer;
    fileEncSha256: Buffer;
    directPath: string;
    [key: string]: any;
}

export class StickerPackService {
    private activeUploads = new Set<string>();

    async uploadToServer(
        sock: WASocket,
        buffer: Buffer,
        options: UploadOptions
    ): Promise<UploadResult> {
        const mediaKey = options.mediaKey || crypto.randomBytes(32);
        const expanded = Buffer.from(
            crypto.hkdfSync('sha256', mediaKey, Buffer.alloc(32), Buffer.from(options.hkdf), 112)
        );

        const iv = expanded.subarray(0, 16);
        const cipherKey = expanded.subarray(16, 48);
        const macKey = expanded.subarray(48, 80);

        const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
        const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);

        const mac = crypto
            .createHmac('sha256', macKey)
            .update(iv)
            .update(encrypted)
            .digest()
            .subarray(0, 10);

        const encBuffer = Buffer.concat([encrypted, mac]);
        const fileSha256 = sha256(buffer);
        const fileEncSha256 = sha256(encBuffer);

        const iq = await (sock as any).query({
            tag: 'iq',
            attrs: {
                id: (sock as any).generateMessageTag?.() ?? Date.now().toString(),
                to: 's.whatsapp.net',
                type: 'set',
                xmlns: 'w:m',
            },
            content: [{ tag: 'media_conn', attrs: {} }],
        });

        const mediaConn = iq.content?.find((v: any) => v.tag === 'media_conn');
        if (!mediaConn) throw new Error('WhatsApp media_conn not found in response');

        const auth = mediaConn.attrs?.auth;
        if (!auth) throw new Error('WhatsApp media_conn auth missing');

        const hosts = (mediaConn.content || [])
            .filter((v: any) => v.tag === 'host')
            .map((v: any) => v.attrs?.hostname)
            .filter(Boolean);

        if (!hosts.length) throw new Error('No WhatsApp CDN upload hosts found');

        const token = encodeURIComponent(toB64Url(fileEncSha256));
        let lastError: any;

        for (const host of hosts) {
            try {
                const json = await new Promise<any>((resolve, reject) => {
                    const url = new URL(
                        `https://${host}${options.mediaPath}/${token}?auth=${encodeURIComponent(auth)}&token=${token}`
                    );

                    const req = https.request(
                        {
                            hostname: url.hostname,
                            port: 443,
                            path: url.pathname + url.search,
                            method: 'POST',
                            headers: {
                                Origin: 'https://web.whatsapp.com',
                                Referer: 'https://web.whatsapp.com/',
                                'Content-Type': 'application/octet-stream',
                                'Content-Length': encBuffer.length,
                            },
                            timeout: 45000,
                        },
                        (res) => {
                            let body = '';
                            res.on('data', (c) => (body += c));
                            res.on('end', () => {
                                if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
                                    return reject(new Error(`Upload failed ${res.statusCode}: ${body}`));
                                }
                                try {
                                    resolve(JSON.parse(body));
                                } catch {
                                    reject(new Error(`Response not JSON: ${body}`));
                                }
                            });
                        }
                    );

                    req.on('timeout', () => {
                        req.destroy(new Error('Upload to WhatsApp CDN timed out (45s)'));
                    });
                    req.on('error', reject);
                    req.write(encBuffer);
                    req.end();
                });

                const directPath = json.direct_path ?? json.directPath ?? json.url ?? json.path;
                if (!directPath) throw new Error('directPath missing from WhatsApp CDN response');

                return {
                    mediaKey,
                    fileLength: buffer.length,
                    fileSha256,
                    fileEncSha256,
                    directPath,
                    ...json,
                };
            } catch (err) {
                splog.warn({ host, err }, 'Host upload failed, trying next CDN host');
                lastError = err;
            }
        }

        throw lastError ?? new Error('All WhatsApp CDN hosts failed for upload');
    }

    async sendStickerPack(
        sock: WASocket,
        jid: string,
        sender: string,
        botId: string,
        options: {
            packName?: string;
            publisher?: string;
            description?: string;
            quotedMsg?: any;
        } = {}
    ): Promise<void> {
        const lockKey = `${botId}:${sender}`;
        if (this.activeUploads.has(lockKey)) {
            throw new Error('ALREADY_PROCESSING');
        }

        this.activeUploads.add(lockKey);

        try {
            const stickersWithBuffers = await stickerStorage.getAllStickers(botId, sender);
            if (stickersWithBuffers.length === 0) {
                throw new Error('PACK_EMPTY');
            }

            splog.info({ sender, count: stickersWithBuffers.length }, 'Building sticker pack archive');

            const zip = new JSZip();
            const stickersMetadata: any[] = [];

            for (const { item, buffer } of stickersWithBuffers) {
                const b64Name = `${toB64Url(sha256(buffer))}.${item.ext}`;
                zip.file(b64Name, buffer);

                stickersMetadata.push({
                    fileName: b64Name,
                    isAnimated: item.isAnimated,
                    emojis: [''],
                    accessibilityLabel: '',
                    isLottie: item.isLottie,
                    mimetype: item.mimetype,
                });
            }

            const trayIconFileName = 'tray_icon.webp';
            const firstStatic = stickersWithBuffers.find((s) => !s.item.isLottie && !s.item.isAnimated);
            const anyNonLottie = stickersWithBuffers.find((s) => !s.item.isLottie);
            const traySource = firstStatic?.buffer || anyNonLottie?.buffer;

            let trayBuffer: Buffer;
            if (traySource) {
                try {
                    trayBuffer = await makeTrayWebp(traySource);
                } catch {
                    trayBuffer = await makeBlankTrayWebp();
                }
            } else {
                trayBuffer = await makeBlankTrayWebp();
            }

            zip.file(trayIconFileName, trayBuffer);

            const archive = await zip.generateAsync({
                type: 'nodebuffer',
                compression: 'STORE',
            });

            splog.info({ size: archive.length }, 'Uploading pack archive to WhatsApp CDN');

            const packUpload = await this.uploadToServer(sock, archive, {
                hkdf: 'WhatsApp Sticker Pack Keys',
                mediaPath: '/mms/sticker-pack',
            });

            const thumbnailBuffer = await makeThumbnailJpeg(trayBuffer);

            splog.info('Uploading pack thumbnail to WhatsApp CDN');

            const thumbUpload = await this.uploadToServer(sock, thumbnailBuffer, {
                hkdf: 'WhatsApp Sticker Pack Thumbnail Keys',
                mediaPath: '/mms/thumbnail-sticker-pack',
                mediaKey: packUpload.mediaKey,
            });

            const manifest = await stickerStorage.getManifest(botId, sender);
            const packName = options.packName || manifest.packName || 'Inori Sticker Pack';
            const publisher = options.publisher || manifest.publisher || 'Inori Bot';
            const packDescription = options.description || 'Created with Inori Bot';

            const stickerPackMessage = {
                stickerPackId: 'Pack_' + crypto.randomBytes(8).toString('hex'),
                name: packName,
                publisher,
                packDescription,
                stickers: stickersMetadata,
                fileLength: packUpload.fileLength,
                fileSha256: packUpload.fileSha256,
                fileEncSha256: packUpload.fileEncSha256,
                mediaKey: packUpload.mediaKey,
                directPath: packUpload.directPath,
                mediaKeyTimestamp: Math.floor(Date.now() / 1000),
                stickerPackSize: packUpload.fileLength,
                stickerPackOrigin: 2,
                trayIconFileName,
                thumbnailDirectPath: thumbUpload.directPath,
                thumbnailSha256: thumbUpload.fileSha256,
                thumbnailEncSha256: thumbUpload.fileEncSha256,
                thumbnailHeight: 252,
                thumbnailWidth: 252,
                imageDataHash: thumbUpload.fileSha256.toString('base64'),
            };

            splog.info({ jid, packName }, 'Relaying stickerPackMessage');

            await (sock as any).relayMessage(
                jid,
                {
                    messageContextInfo: {
                        messageSecret: crypto.randomBytes(32),
                    },
                    stickerPackMessage,
                },
                {
                    quoted: options.quotedMsg,
                }
            );

            splog.info({ jid, count: stickersWithBuffers.length }, 'Sticker pack sent successfully');
        } finally {
            this.activeUploads.delete(lockKey);
        }
    }
}

export const stickerPackService = new StickerPackService();
