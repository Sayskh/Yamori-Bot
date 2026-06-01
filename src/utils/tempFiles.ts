import { promises as fs } from 'fs';
import * as path from 'path';

const TEMP_DIR = path.join(process.cwd(), 'tmp');

export const ensureTempDir = async (): Promise<void> => {
    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => { });
};

export const getTempFilename = (ext: string): string => {
    return path.join(TEMP_DIR, `media_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`);
};

export const deleteFiles = async (files: string[]): Promise<void> => {
    await Promise.all(files.map(f => fs.unlink(f).catch(() => { })));
};
