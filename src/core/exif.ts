import { Image } from 'node-webpmux';

interface ExifOptions {
    packname?: string;
    author?: string;
    categories?: string[];
}

export async function writeExif(inputWebp: Buffer, options: ExifOptions = {}): Promise<Buffer> {
    const img = new Image();
    await img.load(inputWebp);

    const json = JSON.stringify({
        'sticker-pack-id': 'bot-sticker',
        'sticker-pack-name': options.packname || 'Sticker',
        'sticker-pack-publisher': options.author || 'Bot',
        'emojis': options.categories || [''],
    });

    const exifData = Buffer.from(json, 'utf-8');
    const exifHeader = Buffer.from([
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00,
    ]);
    const dataLenBuf = Buffer.alloc(4);
    dataLenBuf.writeUInt32LE(exifData.length);
    const dataPosn = Buffer.from([0x16, 0x00, 0x00, 0x00]);
    const exifFull = Buffer.concat([exifHeader, dataLenBuf, dataPosn, exifData]);

    img.exif = exifFull as any;

    return await img.save(null as any);
}
