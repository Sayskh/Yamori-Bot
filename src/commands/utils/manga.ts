import { WASocket, WAMessage } from 'baileys';
import { Command } from '../../types/Command';
import log from '../../utils/logger';
import { Button } from '../../utils/MessageBuilder';

const mlog = log.child({ module: 'manga' });

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
                mlog.warn({ status: res.status, attempt }, 'Jikan API transient error, retrying...');
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            if (!res.ok) throw new Error(`Jikan API ${res.status}`);
            return await res.json();
        } catch (err: any) {
            if (err.name === 'AbortError' && attempt < MAX_RETRIES) {
                mlog.warn({ attempt }, 'Jikan API timeout, retrying...');
                continue;
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}

async function searchAniListManga(query: string): Promise<any | null> {
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
                        Media (search: $search, type: MANGA) {
                            id
                            idMal
                            siteUrl
                            title { romaji english native }
                            format
                            chapters
                            volumes
                            startDate { year month day }
                            status
                            meanScore
                            genres
                            staff { edges { role node { name { full } } } }
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

        const authorEdge = media.staff?.edges?.find((e: any) => /story|art|author|creator/i.test(e.role)) || media.staff?.edges?.[0];
        const authors = authorEdge?.node?.name?.full || '-';
        const genres = media.genres?.join(', ') || '-';
        const score = media.meanScore ? (media.meanScore / 10).toFixed(1) : 'N/A';
        const published = media.startDate?.year ? `${media.startDate.year}` : '-';

        return {
            title: media.title?.english || media.title?.romaji || 'Unknown',
            title_japanese: media.title?.native || '',
            score,
            rank: 'N/A',
            type: media.format || 'Manga',
            chapters: media.chapters?.toString() || '?',
            volumes: media.volumes?.toString() || '?',
            published,
            status: media.status ? media.status.replace(/_/g, ' ') : '-',
            authors,
            genres,
            synopsis: media.description || '-',
            url: media.idMal ? `https://myanimelist.net/manga/${media.idMal}` : media.siteUrl,
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
        let fullManga: any = null;
        let imageUrl: string | undefined;
        let detailText: string = '';

        // 1. Try Jikan API first
        try {
            const { data } = await fetchJikan(`/manga?q=${encodeURIComponent(query)}&limit=1`);

            if (data && data.length > 0) {
                const manga = data[0];
                fullManga = manga;

                try {
                    const fullRes = await fetchJikan(`/manga/${manga.mal_id}/full`);
                    if (fullRes?.data) {
                        fullManga = fullRes.data;
                    }
                } catch {
                    mlog.warn({ malId: manga.mal_id }, 'Failed to fetch full manga details, using search result');
                }

                const authors = fullManga.authors?.map((a: any) => a.name).join(', ') || '-';
                const genres = fullManga.genres?.map((g: any) => g.name).join(', ') || '-';
                const chapters = fullManga.chapters?.toString() || '?';
                const volumes = fullManga.volumes?.toString() || '?';
                const published = fullManga.published?.string || '-';

                detailText = t('manga_detail', {
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

                imageUrl = fullManga.images?.jpg?.large_image_url || fullManga.images?.jpg?.image_url;
            }
        } catch (jikanErr: any) {
            mlog.warn({ err: jikanErr.message, query }, 'Jikan failed, falling back to AniList...');
        }

        // 2. Fallback to AniList if Jikan failed or returned nothing
        if (!fullManga) {
            try {
                const aniManga = await searchAniListManga(query);
                if (aniManga) {
                    fullManga = aniManga;

                    detailText = t('manga_detail', {
                        score: aniManga.score,
                        rank: aniManga.rank,
                        type: aniManga.type,
                        chapters: aniManga.chapters,
                        volumes: aniManga.volumes,
                        published: aniManga.published,
                        status: aniManga.status,
                        authors: aniManga.authors,
                        genres: aniManga.genres,
                        synopsis: truncateSynopsis(aniManga.synopsis),
                    });

                    imageUrl = aniManga.imageUrl;
                }
            } catch (aniErr: any) {
                mlog.error({ err: aniErr.message, query }, 'AniList fallback also failed');
            }
        }

        if (!fullManga) {
            return sock.sendMessage(from, {
                text: t('manga_not_found', { query }),
            }, { quoted: msg });
        }

        try {
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

            await builder.send(from);
        } catch (buttonErr) {
            mlog.warn({ err: buttonErr, query }, 'Interactive button message failed, sending standard text fallback');

            const title = fullManga.title || 'Unknown';
            const jpTitle = fullManga.title_japanese ? ` (${fullManga.title_japanese})` : '';
            const malUrl = fullManga.url ? `\n\n🔗 *MyAnimeList:* ${fullManga.url}` : '';
            const formattedText = `📖 *${title}*${jpTitle}\n\n${detailText}${malUrl}`;

            await sock.sendMessage(from, {
                text: formattedText,
            }, { quoted: msg });
        }
    },
};

export default command;
