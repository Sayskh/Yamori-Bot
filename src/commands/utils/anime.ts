import { WASocket, WAMessage } from 'baileys';
import { Command } from '../../types/Command';
import log from '../../utils/logger';
import { Button } from '../../utils/MessageBuilder';

const alog = log.child({ module: 'anime' });

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
                alog.warn({ status: res.status, attempt }, 'Jikan API transient error, retrying...');
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                continue;
            }

            if (!res.ok) throw new Error(`Jikan API ${res.status}`);
            return await res.json();
        } catch (err: any) {
            if (err.name === 'AbortError' && attempt < MAX_RETRIES - 1) {
                alog.warn({ attempt }, 'Jikan API timeout, retrying...');
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
    name: 'anime',
    aliases: ['mal'],
    description: 'Search anime from MyAnimeList',
    usage: '<title>',

    async execute(sock, msg, args, context) {
        const { from, prefix, t } = context;

        if (args.length === 0) {
            return sock.sendMessage(from, {
                text: t('anime_usage', { prefix }),
            }, { quoted: msg });
        }

               const query = args.join(' ');

        try {
            const { data } = await fetchJikan(`/anime?q=${encodeURIComponent(query)}&limit=1&sfw=true`);

            if (!data || data.length === 0) {
                await sock.sendMessage(from, {
                    text: t('anime_not_found', { query }),
                }, { quoted: msg });
                return;
            }

            const anime = data[0];
            let fullAnime = anime;

            try {
                const fullRes = await fetchJikan(`/anime/${anime.mal_id}/full`);
                if (fullRes?.data) {
                    fullAnime = fullRes.data;
                }
            } catch (err) {
                alog.warn({ err, malId: anime.mal_id }, 'Failed to fetch full anime details, using search fallback');
            }

            const studios = fullAnime.studios?.map((s: any) => s.name).join(', ') || '-';
            const genres = fullAnime.genres?.map((g: any) => g.name).join(', ') || '-';
            const season = fullAnime.season
                ? fullAnime.season.charAt(0).toUpperCase() + fullAnime.season.slice(1)
                : '-';

            const detailText = t('anime_detail', {
                score: fullAnime.score?.toString() || 'N/A',
                rank: fullAnime.rank?.toString() || 'N/A',
                type: fullAnime.type || '-',
                episodes: fullAnime.episodes?.toString() || '?',
                season,
                year: fullAnime.year?.toString() || '-',
                status: fullAnime.status || '-',
                studios,
                genres,
                synopsis: truncateSynopsis(fullAnime.synopsis),
            });

            const imageUrl = fullAnime.images?.jpg?.large_image_url || fullAnime.images?.jpg?.image_url;

            const builder = new Button(sock)
                .setTitle(fullAnime.title || 'Unknown')
                .setSubtitle(fullAnime.title_japanese || '')
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

            if (fullAnime.url) {
                builder.addUrl(t('anime_open_mal') || 'Open on MyAnimeList', fullAnime.url);
            }

            try {
                // Send the interactive message
                await builder.send(from);
            } catch (buttonErr) {
                alog.error({ err: buttonErr, query }, 'Failed to send interactive anime message, using fallback text message');
                
                // Fallback to text message
                const title = fullAnime.title || 'Unknown';
                const jpTitle = fullAnime.title_japanese ? ` (${fullAnime.title_japanese})` : '';
                const malUrl = fullAnime.url ? `\n\n🔗 *MyAnimeList:* ${fullAnime.url}` : '';
                const formattedText = `🎬 *${title}*${jpTitle}\n\n${detailText}${malUrl}`;

                await sock.sendMessage(from, {
                    text: formattedText,
                }, { quoted: msg });
            }
        } catch (err) {
            alog.error({ err, query }, 'Anime search failed');
            await sock.sendMessage(from, {
                text: t('anime_search_fail'),
            }, { quoted: msg });
        }
    },
};

export default command;
