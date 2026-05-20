import { Command } from '../../types/Command';
import { downloadMedia, ApiError } from '../../services/api';
import log from '../../utils/logger';

const PLATFORMS: Record<string, string> = {
    'tiktok.com': 'tiktok',
    'vm.tiktok.com': 'tiktok',
    'vt.tiktok.com': 'tiktok',
    'twitter.com': 'twitter',
    'x.com': 'twitter',
    'instagram.com': 'instagram',
    'facebook.com': 'facebook',
    'fb.watch': 'facebook',
    'youtube.com': 'youtube',
    'youtu.be': 'youtube',
    'm.youtube.com': 'youtube',
};

const PLATFORM_LABELS: Record<string, string> = {
    tiktok: 'TikTok',
    twitter: 'Twitter/X',
    instagram: 'Instagram',
    facebook: 'Facebook',
    youtube: 'YouTube',
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit (WhatsApp limit ~64MB)
const FETCH_TIMEOUT = 60000; // 60s timeout for media download
const MAX_CAROUSEL_IMAGES = 30;

function detectPlatform(urlString: string): string | null {
    try {
        const url = new URL(urlString);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        const hostname = url.hostname.replace('www.', '');
        return PLATFORMS[hostname] || null;
    } catch {
        return null;
    }
}

async function fetchBuffer(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const contentLength = parseInt(res.headers.get('content-length') || '0');
        if (contentLength > MAX_FILE_SIZE) {
            throw new Error(`File terlalu besar (${(contentLength / 1024 / 1024).toFixed(1)}MB)`);
        }

        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
            throw new Error(`File terlalu besar (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);
        }

        return Buffer.from(arrayBuffer);
    } finally {
        clearTimeout(timeoutId);
    }
}

const command: Command = {
    name: 'download',
    aliases: ['dl'],
    description: 'Download video/slide dari TikTok, Twitter/X, Instagram, Facebook, YouTube',
    usage: '<url>',

    async execute(sock, msg, args, context) {
        const { from, prefix } = context;

        if (!args[0]) {
            return sock.sendMessage(from, {
                text: `*DOWNLOAD — Media Downloader*\n\n`
                    + `${prefix}dl <url>\n\n`
                    + `Platform:\n`
                    + `• TikTok (video & slide)\n`
                    + `• Twitter / X\n`
                    + `• Instagram (Post, Reel, Story)\n`
                    + `• Facebook (Video, Reel)\n`
                    + `• YouTube`,
            }, { quoted: msg });
        }

        const platform = detectPlatform(args[0]);
        if (!platform) {
            return sock.sendMessage(from, {
                text: 'URL tidak valid atau platform tidak didukung.',
            }, { quoted: msg });
        }

        const label = PLATFORM_LABELS[platform] || platform;

        try {
            const result = await downloadMedia(platform, args[0]);
            if (!result || !result.media || result.media.length === 0) {
                return sock.sendMessage(from, { text: 'Media tidak ditemukan atau format tidak didukung.' }, { quoted: msg });
            }

            const caption = result.title
                ? `${result.title}${result.author ? ` — ${result.author}` : ''}`
                : '';

            // Handle Carousel (multiple images)
            if (result.type === 'carousel') {
                const images = result.media.filter((m: any) => m.type === 'image');
                const slice = images.slice(0, MAX_CAROUSEL_IMAGES);
                const skipped = images.length - slice.length;

                for (let i = 0; i < slice.length; i++) {
                    const buffer = await fetchBuffer(slice[i].url);
                    await sock.sendMessage(from, { image: buffer });
                }

                if (caption) {
                    await sock.sendMessage(from, { text: caption });
                }

                if (skipped > 0) {
                    await sock.sendMessage(from, { text: `${skipped} gambar lainnya dilewati.` });
                }
                return;
            }

            // Handle Single Video or Image
            const media = result.media[0];
            const buffer = await fetchBuffer(media.url);

            if (media.type === 'image') {
                await sock.sendMessage(from, { image: buffer, caption }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { video: buffer, caption }, { quoted: msg });
            }

        } catch (e: any) {
            log.error({ err: e, platform }, 'Download command error');
            let text: string;
            if (e instanceof ApiError) {
                text = `Gagal mengunduh (${e.statusCode}).`;
            } else if (e.name === 'AbortError') {
                text = 'Download timeout, coba lagi nanti.';
            } else if (e.message?.includes('terlalu besar')) {
                text = e.message;
            } else {
                text = 'Gagal terhubung ke server.';
            }
            await sock.sendMessage(from, { text }, { quoted: msg });
        }
    },
};

export default command;
