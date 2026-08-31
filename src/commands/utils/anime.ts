import { WASocket, WAMessage } from 'baileys';
import { Command } from '../../types/Command';
import log from '../../utils/logger';
import { Button } from '../../utils/MessageBuilder';

const alog = log.child({ module: 'anime' });

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const SYNOPSIS_MAX_LENGTH = 500;
const FETCH_TIMEOUT = 5000;
const MAX_RETRIES = 1;
const RETRYABLE_CODES = [429, 500, 502, 503, 504];

async function fetchJikan(path: string): Promise<any> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        try {
            const res = await fetch(`${JIKAN_BASE}${path}`, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            });

            if (RETRYABLE_CODES.includes(res.status) && attempt < MAX_RETRIES) {
                alog.warn({ status: res.status, attempt }, 'Jikan API transient error, retrying...');
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            if (!res.ok) throw new Error(`Jikan API ${res.status}`);
            return await res.json();
        } catch (err: any) {
            if (err.name === 'AbortError' && attempt < MAX_RETRIES) {
                alog.warn({ attempt }, 'Jikan API timeout, retrying...');
                continue;
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}

async function searchAniListAnime(query: string): Promise<any | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                query: `
                    query ($search: String) {
                        Media (search: $search, type: ANIME) {
                            id
                            idMal
                            siteUrl
                            title { romaji english native }
                            format
                            episodes
                            season
                            seasonYear
                            status
                            meanScore
                            genres
                            studios(isMain: true) { nodes { name } }
                            coverImage { large }
                            description(asHtml: false)
                        }
                    }
                `,
                variables: { search: query },
            }),
        });

        if (!res.ok) return null;
        const json = await res.json();
        const media = json?.data?.Media;
        if (!media) return null;

        const studios = media.studios?.nodes?.map((s: any) => s.name).join(', ') || '-';
        const genres = media.genres?.join(', ') || '-';
        const score = media.meanScore ? (media.meanScore / 10).toFixed(1) : 'N/A';
        const season = media.season ? media.season.charAt(0).toUpperCase() + media.season.slice(1).toLowerCase() : '-';

        return {
            title: media.title?.english || media.title?.romaji || 'Unknown',
            title_japanese: media.title?.native || '',
            score,
            rank: 'N/A',
            type: media.format || 'TV',
            episodes: media.episodes?.toString() || '?',
            season,
            year: media.seasonYear?.toString() || '-',
            status: media.status ? media.status.replace(/_/g, ' ') : '-',
            studios,
            genres,
            synopsis: media.description || '-',
            url: media.idMal ? `https://myanimelist.net/anime/${media.idMal}` : media.siteUrl,
            imageUrl: media.coverImage?.large,
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

function truncateSynopsis(text: string | null): string {
    if (!text) return '-';
    const clean = text
        .replace(/\[Written by MAL Rewrite\]/gi, '')
        .replace(/<[^>]*>?/gm, '')
        .trim();
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
        let fullAnime: any = null;
        let imageUrl: string | undefined;
        let detailText: string = '';

        // 1. Try Jikan API first
        try {
            const { data } = await fetchJikan(`/anime?q=${encodeURIComponent(query)}&limit=1&sfw=true`);

            if (data && data.length > 0) {
                const anime = data[0];
                fullAnime = anime;

                try {
                    const fullRes = await fetchJikan(`/anime/${anime.mal_id}/full`);
                    if (fullRes?.data) {
                        fullAnime = fullRes.data;
                    }
                } catch {
                    alog.warn({ malId: anime.mal_id }, 'Failed to fetch full anime details, using search result');
                }

                const studios = fullAnime.studios?.map((s: any) => s.name).join(', ') || '-';
                const genres = fullAnime.genres?.map((g: any) => g.name).join(', ') || '-';
                const season = fullAnime.season
                    ? fullAnime.season.charAt(0).toUpperCase() + fullAnime.season.slice(1)
                    : '-';

                detailText = t('anime_detail', {
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

                imageUrl = fullAnime.images?.jpg?.large_image_url || fullAnime.images?.jpg?.image_url;
            }
        } catch (jikanErr: any) {
            alog.warn({ err: jikanErr.message, query }, 'Jikan failed, falling back to AniList...');
        }

        // 2. Fallback to AniList if Jikan failed or returned nothing
        if (!fullAnime) {
            try {
                const aniAnime = await searchAniListAnime(query);
                if (aniAnime) {
                    fullAnime = aniAnime;

                    detailText = t('anime_detail', {
                        score: aniAnime.score,
                        rank: aniAnime.rank,
                        type: aniAnime.type,
                        episodes: aniAnime.episodes,
                        season: aniAnime.season,
                        year: aniAnime.year,
                        status: aniAnime.status,
                        studios: aniAnime.studios,
                        genres: aniAnime.genres,
                        synopsis: truncateSynopsis(aniAnime.synopsis),
                    });

                    imageUrl = aniAnime.imageUrl;
                }
            } catch (aniErr: any) {
                alog.error({ err: aniErr.message, query }, 'AniList fallback also failed');
            }
        }

        if (!fullAnime) {
            return sock.sendMessage(from, {
                text: t('anime_not_found', { query }),
            }, { quoted: msg });
        }

        try {
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

            await builder.send(from);
        } catch (buttonErr) {
            alog.warn({ err: buttonErr, query }, 'Interactive button message failed, sending standard text fallback');

            const title = fullAnime.title || 'Unknown';
            const jpTitle = fullAnime.title_japanese ? ` (${fullAnime.title_japanese})` : '';
            const malUrl = fullAnime.url ? `\n\n🔗 *MyAnimeList:* ${fullAnime.url}` : '';
            const formattedText = `🎬 *${title}*${jpTitle}\n\n${detailText}${malUrl}`;

            await sock.sendMessage(from, {
                text: formattedText,
            }, { quoted: msg });
        }
    },
};

export default command;
