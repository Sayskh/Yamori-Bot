import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import webp from 'node-webpmux';

const FFMPEG = ffmpegPath || 'ffmpeg';
const TEMP_DIR = path.join(process.cwd(), 'tmp');

function runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(FFMPEG, args, { maxBuffer: 20 * 1024 * 1024, timeout: 30000 }, (error) => {
            if (error) return reject(new Error(`FFmpeg failed: ${error.message}`));
            resolve();
        });
    });
}

function ffmpegPathSafe(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

export async function imageToWebp(inputPath: string, outputPath: string): Promise<void> {
    await runFfmpeg([
        '-y',
        '-i', inputPath,
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1',
        '-vcodec', 'libwebp',
        '-lossless', '0',
        '-compression_level', '6',
        '-q:v', '60',
        '-preset', 'default',
        '-an',
        '-s', '512:512',
        outputPath
    ]);
}

export async function videoToWebp(inputPath: string, outputPath: string): Promise<void> {
    await runFfmpeg([
        '-y',
        '-i', inputPath,
        '-t', '5',
        '-vf', 'fps=10,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1',
        '-vcodec', 'libwebp',
        '-lossless', '0',
        '-compression_level', '6',
        '-q:v', '40',
        '-loop', '0',
        '-preset', 'default',
        '-an',
        '-fps_mode', 'vfr',
        '-s', '512:512',
        outputPath
    ]);
}

export async function webpToImage(inputPath: string, outputPath: string): Promise<void> {
    await runFfmpeg(['-y', '-i', inputPath, outputPath]);
}

export async function webpToVideo(inputPath: string, outputPath: string): Promise<void> {
    const img = new webp.Image();
    await img.load(inputPath);

    const frameBuffers = await img.demux({ buffers: true });
    if (!frameBuffers.length) {
        throw new Error('Animated WebP has no frames');
    }

    const framesDir = path.join(TEMP_DIR, `awp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(framesDir, { recursive: true });

    try {
        const framePaths: string[] = [];
        const durations: number[] = [];

        for (let i = 0; i < frameBuffers.length; i++) {
            const framePath = path.join(framesDir, `frame_${String(i).padStart(4, '0')}.webp`);
            await fs.writeFile(framePath, frameBuffers[i]);
            framePaths.push(framePath);

            const delayMs = img.frames?.[i]?.delay ?? 100;
            const delaySec = Math.max(0.06, delayMs / 1000);
            durations.push(delaySec);
        }

        const concatLines: string[] = [];
        for (let i = 0; i < framePaths.length; i++) {
            concatLines.push(`file '${ffmpegPathSafe(framePaths[i])}'`);
            concatLines.push(`duration ${durations[i].toFixed(3)}`);
        }
        concatLines.push(`file '${ffmpegPathSafe(framePaths[framePaths.length - 1])}'`);

        const concatPath = path.join(framesDir, 'concat.txt');
        await fs.writeFile(concatPath, concatLines.join('\n'));

        await runFfmpeg([
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concatPath,
            '-vsync', 'vfr',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
            '-an',
            '-c:v', 'libx264',
            '-crf', '28',
            '-preset', 'faster',
            '-movflags', '+faststart',
            outputPath
        ]);
    } finally {
        await fs.rm(framesDir, { recursive: true, force: true }).catch(() => { });
    }
}

export async function mediaToMp4(inputPath: string, outputPath: string): Promise<void> {
    await runFfmpeg([
        '-y',
        '-i', inputPath,
        '-vf', 'fps=20,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
        '-an',
        '-c:v', 'libx264',
        '-crf', '28',
        '-preset', 'faster',
        '-movflags', '+faststart',
        outputPath
    ]);
}
