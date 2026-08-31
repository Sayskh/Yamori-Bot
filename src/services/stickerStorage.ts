import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { extractNumericId } from '../utils/jid';
import log from '../utils/logger';

const slog = log.child({ module: 'stickerStorage' });

export const MAX_STICKERS_PER_PACK = 30;
export const MAX_STICKER_SIZE = 1024 * 1024; // 1MB

export interface StickerItem {
    sha256: string;
    fileName: string;
    ext: string;
    mimetype: string;
    isAnimated: boolean;
    isLottie: boolean;
    addedAt: number;
}

export interface StickerPackManifest {
    packName?: string;
    publisher?: string;
    updatedAt: number;
    stickers: StickerItem[];
}

function sanitizeId(id: string): string {
    const numeric = extractNumericId(id);
    if (numeric) return numeric;
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

export class StickerStorage {
    private baseDir: string = path.join(process.cwd(), 'data', 'stickers');

    getUserPackDir(botId: string, sender: string): string {
        const safeBot = sanitizeId(botId) || 'default_bot';
        const safeUser = sanitizeId(sender) || 'unknown_user';
        return path.join(this.baseDir, safeBot, safeUser);
    }

    private getManifestPath(botId: string, sender: string): string {
        return path.join(this.getUserPackDir(botId, sender), 'manifest.json');
    }

    async getManifest(botId: string, sender: string): Promise<StickerPackManifest> {
        const manifestPath = this.getManifestPath(botId, sender);
        try {
            if (fsSync.existsSync(manifestPath)) {
                const data = await fs.readFile(manifestPath, 'utf-8');
                return JSON.parse(data) as StickerPackManifest;
            }
        } catch (err) {
            slog.warn({ err, botId, sender }, 'Failed to read manifest, returning empty');
        }

        return {
            updatedAt: Date.now(),
            stickers: []
        };
    }

    async saveManifest(botId: string, sender: string, manifest: StickerPackManifest): Promise<void> {
        const userDir = this.getUserPackDir(botId, sender);
        await fs.mkdir(userDir, { recursive: true });
        const manifestPath = this.getManifestPath(botId, sender);
        manifest.updatedAt = Date.now();
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    }

    async addSticker(
        botId: string,
        sender: string,
        buffer: Buffer,
        options: { isAnimated: boolean; isLottie: boolean; ext?: string; mimetype?: string }
    ): Promise<{ count: number; sha256: string; item: StickerItem }> {
        if (buffer.length > MAX_STICKER_SIZE) {
            throw new Error('STICKER_TOO_LARGE');
        }

        const manifest = await this.getManifest(botId, sender);

        if (manifest.stickers.length >= MAX_STICKERS_PER_PACK) {
            throw new Error('PACK_FULL');
        }

        const sha256Hex = crypto.createHash('sha256').update(buffer).digest('hex');

        if (manifest.stickers.some(s => s.sha256 === sha256Hex)) {
            throw new Error('ALREADY_EXISTS');
        }

        const userDir = this.getUserPackDir(botId, sender);
        await fs.mkdir(userDir, { recursive: true });

        const ext = options.ext || (options.isLottie ? 'json' : 'webp');
        const mimetype = options.mimetype || (options.isLottie ? 'application/json' : 'image/webp');
        const fileName = `${sha256Hex}.${ext}`;
        const filePath = path.join(userDir, fileName);

        await fs.writeFile(filePath, buffer);

        const item: StickerItem = {
            sha256: sha256Hex,
            fileName,
            ext,
            mimetype,
            isAnimated: options.isAnimated,
            isLottie: options.isLottie,
            addedAt: Date.now()
        };

        manifest.stickers.push(item);
        await this.saveManifest(botId, sender, manifest);

        slog.info({ sender, sha256: sha256Hex, total: manifest.stickers.length }, 'Sticker added to pack');
        return { count: manifest.stickers.length, sha256: sha256Hex, item };
    }

    async removeSticker(botId: string, sender: string, targetShaOrIndex: string | number): Promise<boolean> {
        const manifest = await this.getManifest(botId, sender);
        if (manifest.stickers.length === 0) return false;

        let targetIndex = -1;

        if (typeof targetShaOrIndex === 'number') {
            const idx = targetShaOrIndex - 1;
            if (idx >= 0 && idx < manifest.stickers.length) {
                targetIndex = idx;
            }
        } else {
            targetIndex = manifest.stickers.findIndex(s => s.sha256 === targetShaOrIndex);
        }

        if (targetIndex === -1) return false;

        const removed = manifest.stickers.splice(targetIndex, 1)[0];
        const userDir = this.getUserPackDir(botId, sender);
        const filePath = path.join(userDir, removed.fileName);

        try {
            if (fsSync.existsSync(filePath)) {
                await fs.unlink(filePath);
            }
        } catch (err) {
            slog.warn({ err, filePath }, 'Failed to delete sticker file from disk');
        }

        await this.saveManifest(botId, sender, manifest);
        slog.info({ sender, removed: removed.sha256, remaining: manifest.stickers.length }, 'Sticker removed from pack');
        return true;
    }

    async removeStickers(botId: string, sender: string, targets: Array<string | number>): Promise<{ removedCount: number; remainingCount: number }> {
        const manifest = await this.getManifest(botId, sender);
        if (manifest.stickers.length === 0 || targets.length === 0) {
            return { removedCount: 0, remainingCount: manifest.stickers.length };
        }

        const indicesToRemove = new Set<number>();
        for (const target of targets) {
            if (typeof target === 'number') {
                const idx = target - 1;
                if (idx >= 0 && idx < manifest.stickers.length) {
                    indicesToRemove.add(idx);
                }
            } else if (typeof target === 'string') {
                const idx = manifest.stickers.findIndex(s => s.sha256 === target);
                if (idx !== -1) {
                    indicesToRemove.add(idx);
                }
            }
        }

        if (indicesToRemove.size === 0) {
            return { removedCount: 0, remainingCount: manifest.stickers.length };
        }

        // Sort descending so splicing from back doesn't affect earlier indices
        const sortedIndices = Array.from(indicesToRemove).sort((a, b) => b - a);
        const userDir = this.getUserPackDir(botId, sender);

        for (const idx of sortedIndices) {
            const [removed] = manifest.stickers.splice(idx, 1);
            if (removed) {
                const filePath = path.join(userDir, removed.fileName);
                try {
                    if (fsSync.existsSync(filePath)) {
                        await fs.unlink(filePath);
                    }
                } catch (err) {
                    slog.warn({ err, filePath }, 'Failed to delete sticker file from disk');
                }
            }
        }

        await this.saveManifest(botId, sender, manifest);
        slog.info({ sender, removedCount: sortedIndices.length, remaining: manifest.stickers.length }, 'Batch stickers removed from pack');
        return { removedCount: sortedIndices.length, remainingCount: manifest.stickers.length };
    }

    async clearPack(botId: string, sender: string): Promise<void> {
        const userDir = this.getUserPackDir(botId, sender);
        if (fsSync.existsSync(userDir)) {
            await fs.rm(userDir, { recursive: true, force: true });
        }
        slog.info({ sender }, 'Sticker pack cleared');
    }

    async getAllStickers(botId: string, sender: string): Promise<Array<{ item: StickerItem; buffer: Buffer }>> {
        const manifest = await this.getManifest(botId, sender);
        const userDir = this.getUserPackDir(botId, sender);
        const results: Array<{ item: StickerItem; buffer: Buffer }> = [];

        for (const item of manifest.stickers) {
            const filePath = path.join(userDir, item.fileName);
            try {
                if (fsSync.existsSync(filePath)) {
                    const buffer = await fs.readFile(filePath);
                    results.push({ item, buffer });
                }
            } catch (err) {
                slog.warn({ err, filePath }, 'Skipping missing sticker file');
            }
        }

        return results;
    }
}

export const stickerStorage = new StickerStorage();
