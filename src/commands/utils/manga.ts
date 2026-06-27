import { WASocket, WAMessage } from 'baileys';
import { Command } from '../../types/Command';
import log from '../../utils/logger';
import { Button } from '../../utils/MessageBuilder';

const mlog = log.child({ module: 'manga' });

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const SYNOPSIS_MAX_LENGTH = 500;
const FETCH_TIMEOUT = 20000;
const MAX_RETRIES = 3;
const RETRYABLE_CODES = [429, 500, 502, 503, 504];

async function fetchJikan(path: string): Promise<any> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        try {
            const res = await fetch(`${JIKAN_BASE}${path}`, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' },
            });

            if (RETRYABLE_CODES.includes(res.status) && attempt < MAX_RETRIES - 1) {
                mlog.warn({ status: res.status, attempt }, 'Jikan API transient error, retrying...');
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                continue;
            }

            if (!res.ok) throw new Error(`Jikan API ${res.status}`);
            return await res.json();
        } catch (err: any) {
            if (err.name === 'AbortError' && attempt < MAX_RETRIES - 1) {
                mlog.warn({ attempt }, 'Jikan API timeout, retrying...');
                continue;
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}

function truncateSynopsis(text: string | null): string {
    if (!text) return '-';
    const clean = text.replace(/\[Written by MAL Rewrite\]/gi, '').trim();
    if (clean.length <= SYNOPSIS_MAX_LENGTH) return clean;
    return clean.slice(0, SYNOPSIS_MAX_LENGTH).replace(/\s+\S*$/, '') + '...';
}

const command: Command = {
    name: 'manga',
    aliases: ['mangamal'],
    description: 'Search manga from MyAnimeList',
    usage: '<title>',

    async execute(sock, msg, args, context) {
        const { from, prefix, t } = context;

        if (args.length === 0) {
            return sock.sendMessage(from, {
                text: t('manga_usage', { prefix }),
            }, { quoted: msg });
        }

        const query = args.join(' ');

        try {
            const { data } = await fetchJikan(`/manga?q=${encodeURIComponent(query)}&limit=1`);

            if (!data || data.length === 0) {
                await sock.sendMessage(from, {
                    text: t('manga_not_found', { query }),
                }, { quoted: msg });
                return;
            }

            const manga = data[0];
            let fullManga = manga;

            try {
                const fullRes = await fetchJikan(`/manga/${manga.mal_id}/full`);
                if (fullRes?.data) {
                    fullManga = fullRes.data;
                }
            } catch (err) {
                mlog.warn({ err, malId: manga.mal_id }, 'Failed to fetch full manga details, using search fallback');
            }

            const authors = fullManga.authors?.map((a: any) => a.name).join(', ') || '-';
            const genres = fullManga.genres?.map((g: any) => g.name).join(', ') || '-';
            const chapters = fullManga.chapters?.toString() || '?';
            const volumes = fullManga.volumes?.toString() || '?';
            const published = fullManga.published?.string || '-';

            const detailText = t('manga_detail', {
                score: fullManga.score?.toString() || 'N/A',
                rank: fullManga.rank?.toString() || 'N/A',
                type: fullManga.type || '-',
                chapters,
                volumes,
                published,
                status: fullManga.status || '-',
                authors,
                genres,
                synopsis: truncateSynopsis(fullManga.synopsis),
            });

            const imageUrl = fullManga.images?.jpg?.large_image_url || fullManga.images?.jpg?.image_url;

            const builder = new Button(sock)
                .setTitle(fullManga.title || 'Unknown')
                .setSubtitle(fullManga.title_japanese || '')
                .setBody(detailText)
                .setFooter('MyAnimeList')
                .setContextInfo({
                    quotedMessage: msg.message,
                    stanzaId: msg.key.id,
                    participant: msg.key.participant || msg.key.remoteJid,
                });

            if (imageUrl) {
                builder.setImage(imageUrl);
            }

            if (fullManga.url) {
                builder.addUrl(t('manga_open_mal') || 'Open on MyAnimeList', fullManga.url);
            }

            try {
                // Send the interactive message
                await builder.send(from);
            } catch (buttonErr) {
                mlog.error({ err: buttonErr, query }, 'Failed to send interactive manga message, using fallback text message');
                
                // Fallback to text message
                const title = fullManga.title || 'Unknown';
                const jpTitle = fullManga.title_japanese ? ` (${fullManga.title_japanese})` : '';
                const malUrl = fullManga.url ? `\n\n🔗 *MyAnimeList:* ${fullManga.url}` : '';
                const formattedText = `📖 *${title}*${jpTitle}\n\n${detailText}${malUrl}`;

                await sock.sendMessage(from, {
                    text: formattedText,
                }, { quoted: msg });
            }
        } catch (err) {
            mlog.error({ err, query }, 'Manga search failed');
            await sock.sendMessage(from, {
                text: t('manga_search_fail'),
            }, { quoted: msg });
        }
    },
};

export default command;
