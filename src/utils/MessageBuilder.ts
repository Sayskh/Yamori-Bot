/**
 * Advanced WhatsApp Interactive Message Builder for Baileys
 *
 * Supports: Button, ButtonV2, Carousel, AIRich,
 * fluent chaining, flexible payload customization.
 */

import {
    generateWAMessageFromContent,
    prepareWAMessageMedia,
    WASocket,
    WAMessage,
} from 'baileys';
import crypto from 'crypto';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough, Readable } from 'stream';

export const VERSION = '4.6.01';

// ─── Types ──────────────────────────────────────────

interface IEOptions {
    extract?: boolean;
    hyperlink?: boolean;
    citation?: boolean;
    latex?: boolean;
}

interface IEResult {
    text: string;
    ie: IEData[];
    inline_entities: InlineEntity[];
}

interface IEData {
    type: 'hyperlink' | 'citation' | 'latex';
    ie: Record<string, any>;
}

interface InlineEntity {
    key: string;
    metadata: Record<string, any>;
}

interface ResolveMediaOptions {
    resolveUrl?: boolean;
    resolveWAUrl?: boolean;
    result?: 'url' | 'buffer' | 'base64';
    resize?: boolean;
    width?: number;
    height?: number;
}

interface Mp4PreviewOptions {
    time?: number;
    result?: 'buffer' | 'base64';
    resize?: boolean;
    width?: number;
    height?: number;
    silent?: boolean;
}

interface CodeToken {
    codeContent: string;
    highlightType: number;
}

interface UnifiedCodeBlock {
    content: string;
    type: string;
}

interface TokenizerResult {
    codeBlock: CodeToken[];
    unified_codeBlock: UnifiedCodeBlock[];
}

interface TableMetadata {
    title: string;
    rows: { items: string[]; isHeading?: boolean }[];
    unified_rows: any[];
}

interface AIRichBuildOptions {
    forwarded?: boolean;
    notification?: boolean;
    includesUnifiedResponse?: boolean;
    includesSubmessages?: boolean;
    quoted?: WAMessage;
    quotedParticipant?: string;
    [key: string]: any;
}

// ─── extractIE ──────────────────────────────────────

function extractIE(
    text: string,
    { extract = true, hyperlink = true, citation = true, latex = true }: IEOptions = {},
): IEResult {
    if (!extract) {
        return { text, ie: [], inline_entities: [] };
    }

    const createIE = (type: string, ie: Record<string, any>): InlineEntity | undefined => {
        if (type === 'hyperlink') {
            return {
                key: ie.key,
                metadata: {
                    display_name: ie.text,
                    is_trusted: ie.is_trusted,
                    url: ie.url,
                    __typename: 'GenAIInlineLinkItem',
                },
            };
        }

        if (type === 'citation') {
            return {
                key: ie.key,
                metadata: {
                    reference_id: ie.reference_id,
                    reference_url: ie.url,
                    reference_title: ie.url,
                    reference_display_name: ie.url,
                    sources: [],
                    __typename: 'GenAISearchCitationItem',
                },
            };
        }

        if (type === 'latex') {
            return {
                key: ie.key,
                metadata: {
                    latex_expression: ie.text,
                    latex_image: {
                        url: ie.url,
                        width: Number(ie.width) || 100,
                        height: Number(ie.height) || 100,
                    },
                    font_height: Number(ie.font_height) || 83.333333333333,
                    padding: Number(ie.padding) || 15,
                    __typename: 'GenAILatexItem',
                },
            };
        }

        return undefined;
    };

    const ie: IEData[] = [];
    const inline_entities: InlineEntity[] = [];
    let result = '';
    let last = 0;
    let citation_index = 1;
    let hyperlink_index = 0;
    let latex_index = 0;
    const stack: number[] = [];

    for (let i = 0; i < text.length; i++) {
        if (text[i] === '[' && text[i - 1] !== '\\') {
            stack.push(i);
        } else if (text[i] === ']' && (text[i + 1] === '(' || text[i + 1] === '<')) {
            const start = stack.pop();
            if (start == null) continue;

            const open = text[i + 1];
            const close = open === '(' ? ')' : '>';
            const type = open === '(' ? 'link' : 'latex';
            let end = i + 2;
            let depth = 1;

            while (end < text.length && depth) {
                if (text[end] === open && text[end - 1] !== '\\') depth++;
                else if (text[end] === close && text[end - 1] !== '\\') depth--;
                end++;
            }

            if (depth) continue;

            const raw = text.slice(start + 1, i).trim();
            let url = text.slice(i + 2, end - 1).trim();

            let key: string;
            let tag: string;
            let data: IEData;

            if (type === 'latex') {
                if (!latex) continue;

                const [
                    txt = '',
                    width = null,
                    height = null,
                    font_height = null,
                    padding = null,
                ] = raw.split('|');

                key = `MB_LATEX_${latex_index++}`;
                tag = `{{${key}}}${txt || 'image'}{{/${key}}}`;

                data = {
                    type: 'latex',
                    ie: { key, text: txt, url, width, height, font_height, padding },
                };
            } else if (raw) {
                if (!hyperlink) continue;

                const trusted = !url.startsWith('!');
                if (!trusted) url = url.slice(1);

                key = `MB_HYPERLINK_${hyperlink_index++}`;
                tag = `{{${key}}}${url}{{/${key}}}`;

                data = {
                    type: 'hyperlink',
                    ie: { key, text: raw, url, is_trusted: trusted },
                };
            } else {
                if (!citation) continue;

                key = `MB_CITATION_${citation_index - 1}`;
                tag = `{{${key}}}${url}{{/${key}}}`;

                data = {
                    type: 'citation',
                    ie: { reference_id: citation_index++, key, text: '', url },
                };
            }

            result += text.slice(last, start) + tag;
            last = end;

            ie.push(data);

            const entity = createIE(data.type, data.ie);
            if (entity) inline_entities.push(entity);

            i = end - 1;
        }
    }

    result += text.slice(last);
    return { text: result, ie, inline_entities };
}

// ─── waitAllPromises ────────────────────────────────

async function waitAllPromises<T>(input: T): Promise<T> {
    const isPromise = (v: any): v is Promise<any> => v && typeof v.then === 'function';
    const isObject = (v: any): v is Record<string, any> => v && typeof v === 'object';

    const deep = async (v: any): Promise<any> => {
        if (isPromise(v)) return deep(await v);
        if (Array.isArray(v)) return Promise.all(v.map(deep));
        if (isObject(v)) {
            const entries = await Promise.all(
                Object.entries(v).map(async ([k, val]) => [k, await deep(val)] as const),
            );
            return Object.fromEntries(entries);
        }
        return v;
    };

    return deep(await input);
}

// ─── Toolkit ────────────────────────────────────────

export class Toolkit {
    static extractIE(
        text: string,
        { extract = true, hyperlink = true, citation = true, latex = true }: IEOptions = {},
    ): IEResult {
        return extractIE(text, { extract, hyperlink, citation, latex });
    }

    static async resize(
        buffer: Buffer,
        x: number,
        y: number,
        fit: 'contain' | 'cover' | 'fill' | 'inside' | 'outside' = 'cover',
    ): Promise<Buffer> {
        return await sharp(buffer)
            .resize(x, y, {
                fit,
                position: 'center',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer();
    }

    static async waitAllPromises<T>(input: T): Promise<T> {
        return await waitAllPromises(input);
    }

    static async fetchBuffer(
        url: string,
        options: RequestInit = {},
        { silent = true }: { silent?: boolean } = {},
    ): Promise<Buffer> {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            if (silent) return Buffer.alloc(0);
            throw error;
        }
    }

    static async toUrl(
        _client: WASocket,
        path: string | Buffer,
        mediaType: string = 'document',
    ): Promise<string | undefined> {
        if (!path) throw new Error('Url or buffer needed');

        const media = await prepareWAMessageMedia(
            { [mediaType]: Buffer.isBuffer(path) ? path : { url: path } } as any,
            {
                upload: _client.waUploadToServer,
                jid: '@newsletter',
            } as any,
        );

        return (Object.values(media)[0] as any)?.url;
    }

    static async resolveMedia(
        _client: WASocket,
        media: string | Buffer | (string | Buffer)[],
        mediaType: string = 'image',
        {
            resolveUrl = false,
            resolveWAUrl = false,
            result = 'url',
            resize = false,
            width = 300,
            height = 300,
        }: ResolveMediaOptions = {},
    ): Promise<string | Buffer | undefined> {
        const isUrl = (str: string) => /^https?:\/\/.+/i.test(str);
        const isWAUrl = (str: string) => /^https?:\/\/[^/]*\.whatsapp\.net\//i.test(str);

        if (Array.isArray(media)) {
            return Promise.all(
                media.map((item) =>
                    Toolkit.resolveMedia(_client, item, mediaType, {
                        resolveUrl, resolveWAUrl, result, resize, width, height,
                    }),
                ),
            ) as any;
        }

        const originalIsBuffer = Buffer.isBuffer(media);
        let buf: string | Buffer = media;

        if (typeof buf === 'string' && isUrl(buf)) {
            if (isWAUrl(buf)) {
                if (resolveWAUrl) {
                    buf = await Toolkit.fetchBuffer(buf, {}, { silent: true });
                } else if (!resolveUrl) {
                    if (result === 'url') return buf;
                    buf = await Toolkit.fetchBuffer(buf, {}, { silent: true });
                }
            } else {
                if (!resolveUrl) {
                    if (result === 'url') return buf;
                    buf = await Toolkit.fetchBuffer(buf, {}, { silent: true });
                } else {
                    buf = await Toolkit.fetchBuffer(buf, {}, { silent: true });
                }
            }
        }

        if (typeof buf === 'string' && !isUrl(buf)) {
            buf = Buffer.from(buf, 'base64');
        }

        if (!Buffer.isBuffer(buf) || !buf.length) return undefined;

        if (resize && Buffer.isBuffer(buf)) {
            buf = await Toolkit.resize(buf, width, height);
        }

        if (result === 'buffer') return buf;
        if (result === 'base64') return buf.toString('base64') as any;

        return Toolkit.toUrl(_client, buf, mediaType) as any;
    }

    static getMp4Duration(buffer: Buffer, { silent = true }: { silent?: boolean } = {}): number {
        try {
            if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
                if (silent) return 0;
                throw new Error('Invalid buffer');
            }

            let offset = 0;

            while (offset < buffer.length - 8) {
                const size = buffer.readUInt32BE(offset);
                if (size < 8 || offset + size > buffer.length) {
                    if (silent) return 0;
                    throw new Error('Invalid atom size');
                }

                const type = buffer.toString('ascii', offset + 4, offset + 8);

                if (type === 'moov') {
                    let moovOffset = offset + 8;
                    const moovEnd = offset + size;

                    while (moovOffset < moovEnd - 8) {
                        const childSize = buffer.readUInt32BE(moovOffset);
                        if (childSize < 8 || moovOffset + childSize > moovEnd) {
                            if (silent) return 0;
                            throw new Error('Invalid child atom size');
                        }

                        const childType = buffer.toString('ascii', moovOffset + 4, moovOffset + 8);

                        if (childType === 'mvhd') {
                            const version = buffer.readUInt8(moovOffset + 8);

                            if (version === 0) {
                                const timescale = buffer.readUInt32BE(moovOffset + 20);
                                const duration = buffer.readUInt32BE(moovOffset + 24);
                                if (!timescale) {
                                    if (silent) return 0;
                                    throw new Error('Invalid timescale');
                                }
                                return duration / timescale;
                            }

                            if (version === 1) {
                                const timescale = buffer.readUInt32BE(moovOffset + 32);
                                const duration = Number(buffer.readBigUInt64BE(moovOffset + 36));
                                if (!timescale) {
                                    if (silent) return 0;
                                    throw new Error('Invalid timescale');
                                }
                                return duration / timescale;
                            }
                        }

                        moovOffset += childSize;
                    }
                }

                offset += size;
            }

            if (silent) return 0;
            throw new Error('No mvhd found!');
        } catch (err) {
            if (silent) return 0;
            throw err;
        }
    }

    static getMp4Preview(
        videoBuffer: Buffer,
        {
            time,
            result = 'buffer',
            resize = true,
            width = 300,
            height = 300,
            silent = true,
        }: Mp4PreviewOptions = {},
    ): Promise<Buffer | string> {
        return new Promise((resolve, reject) => {
            const fail = (err: Error) => {
                if (silent) {
                    return resolve(result === 'base64' ? '' : Buffer.alloc(0));
                }
                return reject(err);
            };

            try {
                if (!Buffer.isBuffer(videoBuffer) || !videoBuffer.length) {
                    return fail(new Error('videoBuffer is invalid or empty'));
                }

                const inputStream = new Readable({ read() {} });
                inputStream.push(videoBuffer);
                inputStream.push(null);

                const outputStream = new PassThrough();
                const chunks: Buffer[] = [];

                outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));

                outputStream.on('end', async () => {
                    try {
                        let output: any = Buffer.concat(chunks);
                        if (!output.length) {
                            return fail(new Error('Empty output — check video format or timestamp'));
                        }
                        if (resize) {
                            output = await Toolkit.resize(output, width, height);
                        }
                        return resolve(result === 'base64' ? output.toString('base64') : output);
                    } catch (err) {
                        return fail(err as Error);
                    }
                });

                outputStream.on('error', fail);

                time ??= Math.min(Toolkit.getMp4Duration(videoBuffer) * 0.2, 10);

                ffmpeg(inputStream)
                    .outputOptions([`-ss ${time}`, '-vframes 1', '-vcodec png', '-f image2pipe'])
                    .on('error', (err: Error) => fail(new Error(`ffmpeg error: ${err.message}`)))
                    .pipe(outputStream, { end: true });
            } catch (err) {
                return fail(err as Error);
            }
        });
    }
}

// ─── BaseBuilder ────────────────────────────────────

class BaseBuilder {
    protected _title = '';
    protected _subtitle = '';
    protected _body = '';
    protected _footer = '';
    protected _contextInfo: Record<string, any> = {};
    protected _extraPayload: Record<string, any> = {};

    setTitle(title: string): this {
        if (typeof title !== 'string') throw new TypeError('Title must be a string');
        this._title = title;
        return this;
    }

    setSubtitle(subtitle: string): this {
        if (typeof subtitle !== 'string') throw new TypeError('Subtitle must be a string');
        this._subtitle = subtitle;
        return this;
    }

    setBody(body: string): this {
        if (typeof body !== 'string') throw new TypeError('Body must be a string');
        this._body = body;
        return this;
    }

    setFooter(footer: string): this {
        if (typeof footer !== 'string') throw new TypeError('Footer must be a string');
        this._footer = footer;
        return this;
    }

    setContextInfo(obj: Record<string, any>): this {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('ContextInfo must be a plain object');
        }
        this._contextInfo = obj;
        return this;
    }

    addPayload(obj: Record<string, any>): this {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Payload must be a plain object');
        }
        Object.assign(this._extraPayload, obj);
        return this;
    }
}

// ─── Button ─────────────────────────────────────────

interface ButtonItem {
    name: string;
    buttonParamsJson: string;
}

export class Button extends BaseBuilder {
    #client: WASocket;

    private _buttons: ButtonItem[] = [];
    private _data: Record<string, any> | undefined;
    private _currentSelectionIndex = -1;
    private _currentSectionIndex = -1;
    private _params: Record<string, any> = {};

    constructor(client: WASocket) {
        super();
        if (!client) throw new Error('Socket is required');
        this.#client = client;
    }

    setVideo(path: string | Buffer, options: Record<string, any> = {}): this {
        if (!path) throw new Error('Url or buffer needed');
        this._data = Buffer.isBuffer(path)
            ? { video: path, ...options }
            : { video: { url: path }, ...options };
        return this;
    }

    setImage(path: string | Buffer, options: Record<string, any> = {}): this {
        if (!path) throw new Error('Url or buffer needed');
        this._data = Buffer.isBuffer(path)
            ? { image: path, ...options }
            : { image: { url: path }, ...options };
        return this;
    }

    setDocument(path: string | Buffer, options: Record<string, any> = {}): this {
        if (!path) throw new Error('Url or buffer needed');
        this._data = Buffer.isBuffer(path)
            ? { document: path, ...options }
            : { document: { url: path }, ...options };
        return this;
    }

    setMedia(obj: Record<string, any>): this {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Media must be a plain object');
        }
        this._data = obj;
        return this;
    }

    clearButtons(): this {
        this._buttons = [];
        return this;
    }

    setParams(obj: Record<string, any>): this {
        this._params = obj;
        return this;
    }

    addButton(name: string, params: Record<string, any> | string): this {
        this._buttons.push({
            name,
            buttonParamsJson: typeof params === 'string' ? params : JSON.stringify(params),
        });
        return this;
    }

    makeRow(header = '', title = '', description = '', id = ''): this {
        if (this._currentSelectionIndex === -1 || this._currentSectionIndex === -1) {
            throw new Error('You need to create a selection and a section first');
        }
        const buttonParams = JSON.parse(this._buttons[this._currentSelectionIndex].buttonParamsJson);
        buttonParams.sections[this._currentSectionIndex].rows.push({ header, title, description, id });
        this._buttons[this._currentSelectionIndex].buttonParamsJson = JSON.stringify(buttonParams);
        return this;
    }

    makeSection(title = '', highlight_label = ''): this {
        if (this._currentSelectionIndex === -1) {
            throw new Error('You need to create a selection first');
        }
        const buttonParams = JSON.parse(this._buttons[this._currentSelectionIndex].buttonParamsJson);
        buttonParams.sections.push({ title, highlight_label, rows: [] });
        this._currentSectionIndex = buttonParams.sections.length - 1;
        this._buttons[this._currentSelectionIndex].buttonParamsJson = JSON.stringify(buttonParams);
        return this;
    }

    addSelection(title: string, options: Record<string, any> = {}): this {
        this._buttons.push({
            ...options,
            name: 'single_select',
            buttonParamsJson: JSON.stringify({ title, sections: [] }),
        });
        this._currentSelectionIndex = this._buttons.length - 1;
        this._currentSectionIndex = -1;
        return this;
    }

    addReply(display_text = '', id = '', options: Record<string, any> = {}): this {
        this._buttons.push({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({ display_text, id, ...options }),
        });
        return this;
    }

    addCall(display_text = '', id = '', options: Record<string, any> = {}): this {
        this._buttons.push({
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({ display_text, id, ...options }),
        });
        return this;
    }

    addReminder(display_text = '', id = '', options: Record<string, any> = {}): this {
        this._buttons.push({
            name: 'cta_reminder',
            buttonParamsJson: JSON.stringify({ display_text, id, ...options }),
        });
        return this;
    }

    addCancelReminder(display_text = '', id = '', options: Record<string, any> = {}): this {
        this._buttons.push({
            name: 'cta_cancel_reminder',
            buttonParamsJson: JSON.stringify({ display_text, id, ...options }),
        });
        return this;
    }

    addAddress(display_text = '', id = '', options: Record<string, any> = {}): this {
        this._buttons.push({
            name: 'address_message',
            buttonParamsJson: JSON.stringify({ display_text, id, ...options }),
        });
        return this;
    }

    addLocation(options: Record<string, any> = {}): this {
        this._buttons.push({
            name: 'send_location',
            buttonParamsJson: JSON.stringify(options),
        });
        return this;
    }

    addUrl(
        display_text = '',
        url = '',
        webview_interaction = false,
        options: Record<string, any> = {},
    ): this {
        this._buttons.push({
            ...options,
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({ display_text, url, webview_interaction, ...options }),
        });
        return this;
    }

    addCopy(display_text = '', copy_code = '', options: Record<string, any> = {}): this {
        this._buttons.push({
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({ display_text, copy_code, ...options }),
        });
        return this;
    }

    static paramsList: Record<string, Record<string, string | string[]>> = {
        limited_time_offer: {
            text: 'string',
            url: 'string',
            copy_code: 'string',
            expiration_time: 'number',
        },
        bottom_sheet: {
            in_thread_buttons_limit: 'number',
            divider_indices: ['number'],
            list_title: 'string',
            button_title: 'string',
        },
        tap_target_configuration: {
            title: 'string',
            description: 'string',
            canonical_url: 'string',
            domain: 'string',
            buttonIndex: 'number',
        },
    };

    async toCard(): Promise<Record<string, any>> {
        return {
            body: { text: this._body },
            footer: { text: this._footer },
            header: {
                title: this._title,
                subtitle: this._subtitle,
                hasMediaAttachment: !!this._data,
                ...(this._data
                    ? await prepareWAMessageMedia(this._data as any, {
                          upload: this.#client.waUploadToServer,
                      }).catch((e: Error) => {
                          if (String(e).includes('Invalid media type')) return this._data;
                          throw e;
                      })
                    : {}),
            },
            nativeFlowMessage: {
                messageParamsJson: JSON.stringify(this._params),
                buttons: this._buttons,
            },
        };
    }

    async build(jid: string, options: Record<string, any> = {}): Promise<any> {
        const message = await this.toCard();

        return generateWAMessageFromContent(
            jid,
            {
                ...this._extraPayload,
                interactiveMessage: {
                    ...message,
                    contextInfo: this._contextInfo,
                },
            } as any,
            { ...options } as any,
        );
    }

    async send(jid: string, options: Record<string, any> = {}): Promise<any> {
        const msg = await this.build(jid, options);

        await this.#client.relayMessage(msg.key.remoteJid!, msg.message!, {
            messageId: msg.key.id!,
            additionalNodes: [
                {
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [
                                { tag: 'native_flow', attrs: { v: '9', name: 'mixed' } },
                            ],
                        },
                    ],
                },
            ],
            ...options,
        } as any);
        return msg;
    }
}

// ─── ButtonV2 ───────────────────────────────────────

interface ButtonV2Item {
    buttonId: string;
    buttonText: { displayText: string };
    type: number;
}

export class ButtonV2 extends BaseBuilder {
    #client: WASocket;

    private _image: string | Buffer | undefined;
    private _data: Record<string, any> | undefined;
    private _buttons: (ButtonV2Item | Record<string, any>)[] = [];

    constructor(client: WASocket) {
        super();
        if (!client) throw new Error('Socket is required');
        this.#client = client;
    }

    addButton(displayText = '', buttonId: string = crypto.randomUUID()): this {
        this._buttons.push({
            buttonId,
            buttonText: { displayText },
            type: 1,
        });
        return this;
    }

    addRawButton(obj: Record<string, any>): this {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Buttons must be a plain object');
        }
        this._buttons.push(obj);
        return this;
    }

    setThumbnail(path: string | Buffer): this {
        if (!path) throw new Error('Url or buffer needed');
        this._image = path;
        return this;
    }

    setMedia(obj: Record<string, any>): this {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Media must be a plain object');
        }
        this._data = obj;
        return this;
    }

    async build(jid: string, options: Record<string, any> = {}): Promise<any> {
        const _thumbnail = this._image
            ? await Toolkit.resize(
                  Buffer.isBuffer(this._image)
                      ? this._image
                      : await Toolkit.fetchBuffer(this._image, {}, { silent: true }),
                  300,
                  300,
              )
            : null;

        return generateWAMessageFromContent(
            jid,
            {
                ...this._extraPayload,
                buttonsMessage: {
                    contentText: this._body,
                    footerText: this._footer,
                    ...(this._data
                        ? this._data
                        : {
                              headerType: 6,
                              locationMessage: {
                                  degreesLatitude: 0,
                                  degreesLongitude: 0,
                                  name: this._title,
                                  address: this._subtitle,
                                  jpegThumbnail: _thumbnail,
                              },
                          }),
                    viewOnce: true,
                    contextInfo: this._contextInfo,
                    buttons: [...this._buttons],
                },
            } as any,
            { ...options } as any,
        );
    }

    async send(jid: string, options: Record<string, any> = {}): Promise<any> {
        if (this._buttons.length < 1) throw new Error('ButtonV2 requires at least one button');
        const msg = await this.build(jid, options);

        await this.#client.relayMessage(msg.key.remoteJid!, msg.message!, {
            messageId: msg.key.id!,
            additionalNodes: [
                {
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [
                                { tag: 'native_flow', attrs: { v: '9', name: 'mixed' } },
                            ],
                        },
                    ],
                },
            ],
            ...options,
        } as any);
        return msg;
    }
}

// ─── Carousel ───────────────────────────────────────

export class Carousel extends BaseBuilder {
    #client: WASocket;

    private _cards: Record<string, any>[] = [];

    constructor(client: WASocket) {
        super();
        if (!client) throw new Error('Socket is required');
        this.#client = client;
    }

    addCard(card: Record<string, any> | Record<string, any>[]): this {
        const cards = Array.isArray(card) ? card : [card];
        const baseIndex = this._cards.length;

        for (const [index, c] of cards.entries()) {
            if (!c?.header?.hasMediaAttachment) {
                throw new Error(
                    `Card [${baseIndex + index}] must include an image or video in header`,
                );
            }
        }

        this._cards.push(...cards);
        return this;
    }

    build(jid: string, options: Record<string, any> = {}): any {
        return generateWAMessageFromContent(
            jid,
            {
                ...this._extraPayload,
                interactiveMessage: {
                    header: { hasMediaAttachment: false },
                    body: { text: this._body },
                    footer: { text: this._footer },
                    contextInfo: this._contextInfo,
                    carouselMessage: { cards: this._cards },
                },
            } as any,
            { ...options } as any,
        );
    }

    async send(jid: string, options: Record<string, any> = {}): Promise<any> {
        const msg = this.build(jid, options);

        await this.#client.relayMessage(msg.key.remoteJid!, msg.message!, {
            messageId: msg.key.id!,
            additionalNodes: [
                {
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [
                                { tag: 'native_flow', attrs: { v: '9', name: 'mixed' } },
                            ],
                        },
                    ],
                },
            ],
            ...options,
        } as any);
        return msg;
    }
}

// ─── AIRich ─────────────────────────────────────────

export class AIRich extends BaseBuilder {
    #client: WASocket;

    protected _contextInfo: Record<string, any> = {};
    private _submessages: Record<string, any>[] = [];
    private _sections: any[] = [];
    private _richResponseSources: Record<string, any>[] = [];

    constructor(client: WASocket) {
        if (!client) throw new Error('Socket is required');
        super();
        this.#client = client;
    }

    addSubmessage(submessage: Record<string, any> | Record<string, any>[]): this {
        const items = Array.isArray(submessage) ? submessage : [submessage];

        for (const item of items) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                throw new TypeError('Submessage must be a plain object or array of plain objects');
            }
            this._submessages.push(item);
        }

        return this;
    }

    addSection(section: Record<string, any> | Record<string, any>[]): this {
        const items = Array.isArray(section) ? section : [section];

        for (const item of items) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                throw new TypeError('Section must be a plain object or array of plain objects');
            }
            this._sections.push(item);
        }

        return this;
    }

    addText(
        text: string,
        { hyperlink = true, citation = true, latex = true }: IEOptions = {},
    ): this {
        if (typeof text !== 'string') throw new TypeError('Text must be a string');

        const { text: extractedText, inline_entities } = extractIE(text, {
            hyperlink, citation, latex,
        });

        this._submessages.push({ messageType: 2, messageText: extractedText });

        this._sections.push(
            AIRich.newLayout('Single', {
                text: extractedText,
                ...(inline_entities.length && { inline_entities }),
                __typename: 'GenAIMarkdownTextUXPrimitive',
            }),
        );

        return this;
    }

    addCode(language: string, code: string): this {
        if (typeof language !== 'string' || typeof code !== 'string') {
            throw new TypeError('Language and code must be a string');
        }

        const meta = AIRich.tokenizer(code, language);

        this._submessages.push({
            messageType: 5,
            codeMetadata: { codeLanguage: language, codeBlocks: meta.codeBlock },
        });

        this._sections.push(
            AIRich.newLayout('Single', {
                language,
                code_blocks: meta.unified_codeBlock,
                __typename: 'GenAICodeUXPrimitive',
            }),
        );

        return this;
    }

    addTable(
        table: string[][],
        { hyperlink = true, citation = true, latex = true }: IEOptions = {},
    ): this {
        if (!Array.isArray(table)) throw new TypeError('Table must be an array');

        const meta = AIRich.toTableMetadata(table, { hyperlink, citation, latex });

        this._submessages.push({
            messageType: 4,
            tableMetadata: { title: meta.title, rows: meta.rows },
        });

        this._sections.push(
            AIRich.newLayout('Single', {
                rows: meta.unified_rows,
                __typename: 'GenATableUXPrimitive',
            }),
        );

        return this;
    }

    addSource(sources: string[] | string[][] = []): this {
        if (
            !(
                Array.isArray(sources) &&
                (sources.every((item) => typeof item === 'string') ||
                    sources.every(
                        (item) => Array.isArray(item) && item.every((v) => typeof v === 'string'),
                    ))
            )
        ) {
            throw new TypeError('Sources must be a string array or an array of string arrays');
        }

        let normalized: string[][] = sources as string[][];
        if (sources.every((item) => typeof item === 'string')) {
            normalized = [sources as string[]];
        }

        const source = normalized.map(([icon, url, text]) => ({
            source_type: 'THIRD_PARTY',
            source_display_name: text ?? '',
            source_subtitle: 'AI',
            source_url: url ?? '',
            favicon: {
                url: Toolkit.resolveMedia(this.#client, icon ?? '', 'image'),
                mime_type: 'image/jpeg',
                width: 16,
                height: 16,
            },
        }));

        this._sections.push(
            AIRich.newLayout('Single', {
                sources: source,
                __typename: 'GenAISearchResultPrimitive',
            }),
        );

        return this;
    }

    addReels(reelsItems: Record<string, any> | Record<string, any>[] = []): this {
        if (
            !(
                (reelsItems && typeof reelsItems === 'object' && !Array.isArray(reelsItems)) ||
                (Array.isArray(reelsItems) &&
                    reelsItems.every((item) => item && typeof item === 'object' && !Array.isArray(item)))
            )
        ) {
            throw new TypeError('Reels items must be an object or an array of objects');
        }

        const items = Array.isArray(reelsItems) ? reelsItems : [reelsItems];

        const reels = items.map((item) => ({
            ...item,
            _avatar: Toolkit.resolveMedia(
                this.#client,
                item.profileIconUrl ?? item.profile_url ?? item.profile ?? '',
                'image',
            ),
            _thumbnail: Toolkit.resolveMedia(
                this.#client,
                item.thumbnailUrl ?? item.thumbnail ?? '',
                'image',
            ),
        }));

        this._submessages.push({
            messageType: 9,
            contentItemsMetadata: {
                contentType: 1,
                itemsMetadata: reels.map((item) => ({
                    reelItem: {
                        title: item.username ?? '',
                        profileIconUrl: item._avatar,
                        thumbnailUrl: item._thumbnail,
                        videoUrl: item.videoUrl ?? item.url ?? '',
                    },
                })),
            },
        });

        reels.forEach((item, idx) => {
            this._richResponseSources.push({
                provider: 'MessageBuilder',
                thumbnailCDNURL: item._thumbnail,
                sourceProviderURL: item.videoUrl ?? item.url ?? '',
                sourceQuery: '',
                faviconCDNURL: item._avatar,
                citationNumber: idx + 1,
                sourceTitle: item.username ?? '',
            });
        });

        this._sections.push(
            AIRich.newLayout(
                'HScroll',
                reels.map((item) => ({
                    reels_url: item.videoUrl ?? item.url ?? '',
                    thumbnail_url: item._thumbnail,
                    creator: item.username ?? item.title ?? '',
                    avatar_url: item._avatar,
                    reels_title: item.reels_title ?? item.title ?? '',
                    likes_count: item.likes_count ?? item.like ?? 0,
                    shares_count: item.shares_count ?? item.share ?? 0,
                    view_count: item.view_count ?? item.view ?? 0,
                    reel_source: item.reel_source ?? item.source ?? 'IG',
                    is_verified: !!(item.is_verified || item.verified),
                    __typename: 'GenAIReelPrimitive',
                })),
            ),
        );

        return this;
    }

    addImage(
        imageUrl: string | Buffer | (string | Buffer)[],
        { resolveUrl = false }: { resolveUrl?: boolean } = {},
    ): this {
        if (
            !(
                typeof imageUrl === 'string' ||
                Buffer.isBuffer(imageUrl) ||
                (Array.isArray(imageUrl) &&
                    imageUrl.every((v) => typeof v === 'string' || Buffer.isBuffer(v)))
            )
        ) {
            throw new TypeError('imageUrl must be string | buffer | array of string/buffer');
        }

        const list = Array.isArray(imageUrl)
            ? imageUrl.map((v) => {
                  const url = Toolkit.resolveMedia(this.#client, v, 'image', { resolveUrl });
                  return { imagePreviewUrl: url, imageHighResUrl: url, sourceUrl: url };
              })
            : (() => {
                  const url = Toolkit.resolveMedia(this.#client, imageUrl as string | Buffer, 'image', { resolveUrl });
                  return [{ imagePreviewUrl: url, imageHighResUrl: url, sourceUrl: url }];
              })();

        this._submessages.push({
            messageType: 1,
            gridImageMetadata: {
                gridImageUrl: { imagePreviewUrl: list[0]?.imagePreviewUrl },
                imageUrls: list,
            },
        });

        list.forEach(({ imagePreviewUrl }) => {
            this._sections.push(
                AIRich.newLayout('Single', {
                    media: { url: imagePreviewUrl, mime_type: 'image/png' },
                    imagine_type: 'IMAGE',
                    status: { status: 'READY' },
                    __typename: 'GenAIImaginePrimitive',
                }),
            );
        });

        return this;
    }

    addVideo(
        videoUrl: string | Buffer | Record<string, any> | (string | Buffer | Record<string, any>)[],
        { autoFill = true }: { autoFill?: boolean } = {},
    ): this {
        const isObjectVideo = (v: any): v is Record<string, any> => v && typeof v === 'object' && v.url;

        const isValidPrimitive =
            typeof videoUrl === 'string' ||
            Buffer.isBuffer(videoUrl) ||
            isObjectVideo(videoUrl) ||
            (Array.isArray(videoUrl) &&
                (videoUrl as any[]).every((v: any) => typeof v === 'string' || Buffer.isBuffer(v) || isObjectVideo(v)));

        if (!isValidPrimitive) {
            throw new TypeError('videoUrl must be string | buffer | object | array');
        }

        const items = Array.isArray(videoUrl) ? videoUrl : [videoUrl];

        this._submessages.push({
            messageType: 2,
            messageText: '[ CANNOT_LOAD_VIDEO ]',
        });

        items.forEach((item) => {
            const isObject = isObjectVideo(item);

            const url = isObject
                ? Toolkit.resolveMedia(this.#client, (item as Record<string, any>).url ?? '', 'video')
                : Toolkit.resolveMedia(this.#client, item as string | Buffer, 'video');

            const bufferPromise = autoFill
                ? Promise.resolve(url).then((u) => Toolkit.fetchBuffer(u as string))
                : null;

            const file_length =
                isObject && (item as Record<string, any>).file_length != null
                    ? (item as Record<string, any>).file_length
                    : autoFill
                      ? bufferPromise!.then((b) => b?.length ?? 0)
                      : 0;

            const duration =
                isObject && (item as Record<string, any>).duration != null
                    ? (item as Record<string, any>).duration
                    : autoFill
                      ? bufferPromise!.then((b) => Toolkit.getMp4Duration(b, { silent: true }))
                      : 0;

            const thumbnail =
                isObject && (item as Record<string, any>).thumbnail
                    ? Toolkit.resolveMedia(
                          this.#client,
                          (item as Record<string, any>).thumbnail,
                          'image',
                          { result: 'base64', resize: true, width: 300, height: 300 },
                      )
                    : autoFill
                      ? bufferPromise
                          ? bufferPromise.then((b) =>
                                Toolkit.getMp4Preview(b, { time: 0, result: 'base64' }),
                            )
                          : null
                      : null;

            this._sections.push(
                AIRich.newLayout('Single', {
                    media: {
                        url,
                        mime_type: isObject ? ((item as Record<string, any>).mime_type ?? 'video/mp4') : 'video/mp4',
                        file_length,
                        duration,
                    },
                    imagine_type: 'ANIMATE',
                    status: { status: 'READY' },
                    thumbnail: { raw_media: thumbnail },
                    __typename: 'GenAIImaginePrimitive',
                }),
            );
        });

        return this;
    }

    addProduct(data: Record<string, any> | Record<string, any>[] = {}): this {
        if (
            !(
                (data && typeof data === 'object' && !Array.isArray(data)) ||
                (Array.isArray(data) &&
                    data.every((item) => item && typeof item === 'object' && !Array.isArray(item)))
            )
        ) {
            throw new TypeError('Product items must be an object or an array of objects');
        }

        this._submessages.push({
            messageType: 2,
            messageText: '[ CANNOT_LOAD_PRODUCT ]',
        });

        const items = Array.isArray(data) ? data : [data];

        const product = items.map((item) => ({
            title: item.title,
            brand: item.brand,
            price: item.price,
            sale_price: item.sale_price,
            product_url: item.product_url ?? item.url,
            image: {
                url: Toolkit.resolveMedia(this.#client, item.image_url ?? item.image, 'image'),
            },
            additional_images: [
                {
                    url: Toolkit.resolveMedia(this.#client, item.icon_url ?? item.icon, 'image'),
                },
            ],
            __typename: 'GenAIProductItemCardPrimitive',
        }));

        this._sections.push(
            AIRich.newLayout(
                Array.isArray(data) ? 'HScroll' : 'Single',
                Array.isArray(data) ? product : product[0],
            ),
        );

        return this;
    }

    addPost(data: Record<string, any> | Record<string, any>[] = {}): this {
        if (
            !(
                (data && typeof data === 'object' && !Array.isArray(data)) ||
                (Array.isArray(data) &&
                    data.every((item) => item && typeof item === 'object' && !Array.isArray(item)))
            )
        ) {
            throw new TypeError('Post items must be an object or an array of objects');
        }

        const posts = Array.isArray(data) ? data : [data];

        this._submessages.push({
            messageType: 2,
            messageText: '[ CANNOT_LOAD_POST ]',
        });

        const primitives = posts.map((p) => ({
            title: p.title ?? '',
            subtitle: p.subtitle ?? '',
            username: p.username ?? '',
            profile_picture_url: Toolkit.resolveMedia(
                this.#client,
                p.profile_picture_url ?? p.profile_url ?? p.profile ?? '',
                'image',
            ),
            is_verified: !!(p.is_verified || p.verified),
            thumbnail_url: Toolkit.resolveMedia(
                this.#client,
                p.thumbnail_url ?? p.thumbnail ?? '',
                'image',
            ),
            post_caption: p.post_caption ?? p.caption ?? '',
            likes_count: p.likes_count ?? p.like ?? 0,
            comments_count: p.comments_count ?? p.comment ?? 0,
            shares_count: p.shares_count ?? p.share ?? 0,
            post_url: p.post_url ?? p.url ?? '',
            post_deeplink: p.post_deeplink ?? p.deeplink ?? '',
            source_app: p.source_app || p.source || 'INSTAGRAM',
            footer_label: p.footer_label ?? p.footer ?? '',
            footer_icon: Toolkit.resolveMedia(
                this.#client,
                p.footer_icon ?? p.icon ?? '',
                'image',
            ),
            is_carousel: posts.length > 1,
            orientation: p.orientation ?? 'LANDSCAPE',
            post_type: p.post_type ?? 'VIDEO',
            __typename: 'GenAIPostPrimitive',
        }));

        this._sections.push(AIRich.newLayout('HScroll', primitives));

        return this;
    }

    addTip(text: string): this {
        this._submessages.push({ messageType: 2, messageText: text });

        this._sections.push(
            AIRich.newLayout('Single', {
                text,
                __typename: 'GenAIMetadataTextPrimitive',
            }),
        );

        return this;
    }

    addSuggest(
        suggestion: string | string[],
        { scroll = true, layout }: { scroll?: boolean; layout?: string } = {},
    ): this {
        if (
            !(
                typeof suggestion === 'string' ||
                (Array.isArray(suggestion) && suggestion.every((v) => typeof v === 'string'))
            )
        ) {
            throw new TypeError('Suggestion must be a string or array of strings');
        }

        const suggest = Array.isArray(suggestion)
            ? suggestion.map((text) => ({
                  prompt_text: text,
                  prompt_type: 'SUGGESTED_PROMPT',
                  __typename: 'GenAIFollowUpSuggestionPillPrimitive',
              }))
            : [
                  {
                      prompt_text: suggestion,
                      prompt_type: 'SUGGESTED_PROMPT',
                      __typename: 'GenAIFollowUpSuggestionPillPrimitive',
                  },
              ];

        const type =
            layout ?? (suggest.length === 1 ? 'Single' : scroll ? 'HScroll' : 'ActionRow');

        this._sections.push(
            AIRich.newLayout(type, type === 'Single' ? suggest[0] : suggest, {
                __typename: 'GenAIUnifiedResponseSection',
            }),
        );

        return this;
    }

    async build({
        forwarded = true,
        notification = false,
        includesUnifiedResponse = true,
        includesSubmessages = true,
        quoted,
        quotedParticipant,
        ...options
    }: AIRichBuildOptions = {}): Promise<any> {
        const forward = forwarded
            ? {
                  forwardingScore: 1,
                  isForwarded: true,
                  forwardedAiBotMessageInfo: { botJid: '0@bot' },
                  forwardOrigin: 4,
              }
            : {};

        const notif = notification
            ? {
                  sessionTransparencyMetadata: {
                      disclaimerText: '',
                      hcaId: `hca_${Date.now()}`,
                      sessionTransparencyType: 1,
                  },
              }
            : {};

        const qObj = quoted
            ? {
                  stanzaId: quoted?.key?.id || (quoted as any)?.id,
                  participant:
                      quotedParticipant ||
                      quoted?.key?.participant ||
                      quoted?.key?.remoteJid,
                  quotedType: 0,
                  quotedMessage:
                      typeof quoted === 'object' && quoted !== null
                          ? (quoted.message ?? quoted)
                          : undefined,
              }
            : {};

        const sections = this._footer
            ? [
                  ...(await waitAllPromises(this._sections)),
                  AIRich.newLayout('Single', {
                      text: this._footer,
                      __typename: 'GenAIMetadataTextPrimitive',
                  }),
              ]
            : [...(await waitAllPromises(this._sections))];

        return {
            messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2,
                botMetadata: {
                    messageDisclaimerText: this._title,
                    richResponseSourcesMetadata: { sources: this._richResponseSources },
                    ...notif,
                },
            },
            ...this._extraPayload,
            botForwardedMessage: {
                message: {
                    richResponseMessage: {
                        messageType: 1,
                        submessages: includesSubmessages
                            ? await waitAllPromises(this._submessages)
                            : [],
                        unifiedResponse: {
                            data: includesUnifiedResponse
                                ? Buffer.from(
                                      JSON.stringify({
                                          response_id: crypto.randomUUID(),
                                          sections,
                                      }),
                                  ).toString('base64')
                                : '',
                        },
                        contextInfo: {
                            ...forward,
                            ...qObj,
                            ...this._contextInfo,
                        },
                    },
                },
            },
        };
    }

    async send(
        jid: string,
        {
            forwarded,
            notification,
            includesUnifiedResponse,
            includesSubmessages,
            ...options
        }: AIRichBuildOptions = {},
    ): Promise<any> {
        const msg = await this.build({
            forwarded,
            notification,
            includesUnifiedResponse,
            includesSubmessages,
            ...options,
        });

        return await this.#client.relayMessage(jid, msg, { ...options } as any);
    }

    // ─── Static helpers ─────────────────────────────

    static tokenizer(code: string, lang = 'javascript'): TokenizerResult {
        const keywordsMap: Record<string, Set<string>> = {
            javascript: new Set([
                'break', 'case', 'catch', 'continue', 'debugger', 'delete', 'do', 'else',
                'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new', 'return',
                'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with',
                'true', 'false', 'null', 'undefined', 'class', 'const', 'let', 'super',
                'extends', 'export', 'import', 'yield', 'static', 'constructor', 'async',
                'await', 'get', 'set',
            ]),
            typescript: new Set([
                'abstract', 'any', 'as', 'asserts', 'bigint', 'boolean', 'declare', 'enum',
                'implements', 'infer', 'interface', 'is', 'keyof', 'module', 'namespace',
                'never', 'readonly', 'require', 'number', 'object', 'override', 'private',
                'protected', 'public', 'satisfies', 'string', 'symbol', 'type', 'unknown',
                'using', 'from', 'break', 'case', 'catch', 'continue', 'do', 'else',
                'finally', 'for', 'function', 'if', 'new', 'return', 'switch', 'this',
                'throw', 'try', 'var', 'void', 'while', 'class', 'const', 'let', 'extends',
                'import', 'export', 'async', 'await',
            ]),
            python: new Set([
                'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
                'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
                'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
                'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
            ]),
            java: new Set([
                'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
                'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
                'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
                'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
                'package', 'private', 'protected', 'public', 'return', 'short', 'static',
                'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
                'transient', 'try', 'void', 'volatile', 'while',
            ]),
            golang: new Set([
                'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
                'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
                'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type',
                'var',
            ]),
            c: new Set([
                'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
                'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'int',
                'long', 'register', 'return', 'short', 'signed', 'sizeof', 'static',
                'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile',
                'while',
            ]),
            cpp: new Set([
                'alignas', 'alignof', 'and', 'auto', 'bool', 'break', 'case', 'catch',
                'class', 'const', 'constexpr', 'continue', 'delete', 'do', 'double', 'else',
                'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend',
                'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept',
                'nullptr', 'operator', 'private', 'protected', 'public', 'return', 'short',
                'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this',
                'throw', 'true', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using',
                'virtual', 'void', 'while',
            ]),
            php: new Set([
                'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch',
                'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo',
                'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif',
                'endswitch', 'endwhile', 'extends', 'final', 'finally', 'fn', 'for',
                'foreach', 'function', 'global', 'goto', 'if', 'implements', 'include',
                'include_once', 'instanceof', 'interface', 'match', 'namespace', 'new',
                'null', 'or', 'private', 'protected', 'public', 'require', 'require_once',
                'return', 'static', 'switch', 'throw', 'trait', 'try', 'use', 'var',
                'while', 'yield',
            ]),
            rust: new Set([
                'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern',
                'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod',
                'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct',
                'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
            ]),
            html: new Set([
                'html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'video', 'audio',
                'script', 'style', 'link', 'meta', 'form', 'input', 'button', 'table',
                'tr', 'td', 'th', 'ul', 'ol', 'li', 'section', 'article', 'header',
                'footer', 'nav', 'main',
            ]),
            bash: new Set([
                'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case',
                'esac', 'function', 'in', 'select', 'until', 'break', 'continue', 'return',
                'export', 'readonly', 'local', 'declare',
            ]),
            markdown: new Set(['#', '##', '###', '####', '#####', '######']),
        };

        if (!lang || lang === 'txt' || lang === 'text' || lang === 'plaintext') {
            return {
                codeBlock: [{ codeContent: code, highlightType: 0 }],
                unified_codeBlock: [{ content: code, type: 'DEFAULT' }],
            };
        }

        const TYPE_MAP: Record<number, string> = {
            0: 'DEFAULT',
            1: 'KEYWORD',
            2: 'METHOD',
            3: 'STR',
            4: 'NUMBER',
            5: 'COMMENT',
        };

        const keywords = keywordsMap[lang.toLowerCase()] || new Set<string>();
        const tokens: CodeToken[] = [];

        let i = 0;

        const push = (content: string, type: number) => {
            if (!content) return;

            const last = tokens[tokens.length - 1];
            if (last && last.highlightType === type) {
                last.codeContent += content;
            } else {
                tokens.push({ codeContent: content, highlightType: type });
            }
        };

        const isIdentifier = (char: string): boolean => {
            switch (lang.toLowerCase()) {
                case 'css':
                    return /[a-zA-Z0-9_$-]/.test(char);
                case 'html':
                    return /[a-zA-Z0-9_$:-]/.test(char);
                default:
                    return /[a-zA-Z0-9_$]/.test(char);
            }
        };

        while (i < code.length) {
            const c = code[i];

            if (/\s/.test(c)) {
                const s = i;
                while (i < code.length && /\s/.test(code[i])) i++;
                push(code.slice(s, i), 0);
                continue;
            }

            if (
                (c === '/' && code[i + 1] === '/') ||
                (c === '#' && ['python', 'bash'].includes(lang))
            ) {
                const s = i;
                while (i < code.length && code[i] !== '\n') i++;
                push(code.slice(s, i), 5);
                continue;
            }

            if (c === '"' || c === "'" || c === '`') {
                const s = i;
                const q = c;
                i++;
                while (i < code.length) {
                    if (code[i] === '\\' && i + 1 < code.length) {
                        i += 2;
                    } else if (code[i] === q) {
                        i++;
                        break;
                    } else {
                        i++;
                    }
                }
                push(code.slice(s, i), 3);
                continue;
            }

            if (/[0-9]/.test(c)) {
                const s = i;
                while (i < code.length && /[0-9._]/.test(code[i])) i++;
                push(code.slice(s, i), 4);
                continue;
            }

            if (/[a-zA-Z_$]/.test(c)) {
                const s = i;
                while (i < code.length && isIdentifier(code[i])) i++;

                const word = code.slice(s, i);
                let type = 0;

                if (keywords.has(word)) {
                    type = 1;
                } else if (lang === 'css') {
                    let j = i;
                    while (j < code.length && /\s/.test(code[j])) j++;
                    if (code[j] === ':') type = 1;
                } else if (lang === 'html') {
                    let p = s - 1;
                    while (p >= 0 && /\s/.test(code[p])) p--;
                    if (code[p] === '<' || (code[p] === '/' && code[p - 1] === '<')) type = 1;
                }

                if (type === 0) {
                    let j = i;
                    while (j < code.length && /\s/.test(code[j])) j++;
                    if (code[j] === '(') type = 2;
                }

                push(word, type);
                continue;
            }

            push(c, 0);
            i++;
        }

        return {
            codeBlock: tokens,
            unified_codeBlock: tokens.map((t) => ({
                content: t.codeContent,
                type: TYPE_MAP[t.highlightType],
            })),
        };
    }

    static toTableMetadata(
        arr: string[][],
        { hyperlink = true, citation = true, latex = true }: IEOptions = {},
    ): TableMetadata {
        if (
            !Array.isArray(arr) ||
            !arr.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))
        ) {
            throw new TypeError('Table must be a nested array of strings');
        }

        const [header, ...rows] = arr;
        const maxLen = Math.max(header.length, ...rows.map((r) => r.length));
        const normalize = (r: string[]) => [...r, ...Array(maxLen - r.length).fill('')];

        const unified_rows = [
            { is_header: true, cells: normalize(header) },
            ...rows.map((r) => ({ is_header: false, cells: normalize(r) })),
        ].map((row) => {
            const markdown_cells = row.cells.map((cell: string) => {
                const extracted = extractIE(cell, { hyperlink, citation, latex });
                return {
                    text: extracted.text,
                    ...(extracted.inline_entities.length
                        ? { inline_entities: extracted.inline_entities }
                        : {}),
                };
            });

            return {
                ...row,
                ...(markdown_cells.some((c: any) => c.inline_entities?.length)
                    ? { markdown_cells }
                    : {}),
            };
        });

        const rowsMeta = unified_rows.map((r) => ({
            items: r.cells,
            ...(r.is_header ? { isHeading: true } : {}),
        }));

        return { title: '', rows: rowsMeta, unified_rows };
    }

    static newLayout(
        name: string,
        data: any,
        extra: Record<string, any> = {},
    ): Record<string, any> {
        return {
            ...extra,
            view_model: {
                [Array.isArray(data) ? 'primitives' : 'primitive']: data,
                __typename: `GenAI${name}LayoutViewModel`,
            },
        };
    }
}

// ─── bind ───────────────────────────────────────────

export function bind(client: WASocket): WASocket {
    if (!client) throw new Error('Socket is required');

    return Object.defineProperties(client, {
        sendLinkPreview: {
            configurable: true,
            writable: true,
            async value(
                jid: string,
                text: string,
                link: string,
                title: string,
                description?: string,
                thumbnail?: Buffer | { url: string },
                options: Record<string, any> = {},
            ) {
                if (typeof jid !== 'string') throw new TypeError('jid is not string');
                if (typeof text !== 'string') throw new TypeError('text is not string');
                if (typeof link !== 'string') throw new TypeError('link is not string');
                if (typeof title !== 'string') throw new TypeError('title is not string');
                if (description && typeof description !== 'string') {
                    throw new TypeError('description is not string');
                }
                if (
                    thumbnail &&
                    !Buffer.isBuffer(thumbnail) &&
                    typeof (thumbnail as any).url !== 'string'
                ) {
                    throw new TypeError('thumbnail must be Buffer or object with url key');
                }

                const image = thumbnail
                    ? await prepareWAMessageMedia(
                          { image: thumbnail } as any,
                          {
                              upload: client.waUploadToServer,
                              mediaTypeOverride: 'thumbnail-link',
                          } as any,
                      ).then((v: any) => v.imageMessage)
                    : undefined;

                const finalText = text.includes(link) ? text : `${link}\n${text}`;

                return await client.sendMessage(
                    jid,
                    {
                        text: finalText,
                        linkPreview: {
                            'matched-text': link,
                            title,
                            description,
                            jpegThumbnail: image?.jpegThumbnail,
                            highQualityThumbnail: image,
                        },
                    } as any,
                    options,
                );
            },
        },
    });
}
