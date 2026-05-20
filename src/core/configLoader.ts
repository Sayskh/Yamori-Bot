import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import log from '../utils/logger';

const CONFIG_DIR = path.join(process.cwd(), 'src/config');
const MENU_YAML_PATH = path.join(CONFIG_DIR, 'menu.yml');
const ADMIN_YAML_PATH = path.join(CONFIG_DIR, 'admin.yml');
const DEV_YAML_PATH = path.join(CONFIG_DIR, 'dev.yml');

// --- Types ---

export interface MenuConfig {
    header: string;
    footer: string;
    categoryHeader: string;
    commandItem: string;
    categoryLabels: Record<string, string>;
    categoriesOrder: string[];
}

export interface AdminConfig {
    welcome_template: string;
    goodbye_template: string;
    promote_template: string;
    demote_template: string;
    kick_template: string;
    lock_template: string;
    unlock_template: string;
    groupinfo_template: string;
}

export interface DevConfig {
    broadcast_template: string;
}

// --- Cache ---

let cachedMenuConfig: MenuConfig | null = null;
let cachedAdminConfig: AdminConfig | null = null;
let cachedDevConfig: DevConfig | null = null;

// --- Loaders ---

export function getMenuConfig(): MenuConfig {
    if (cachedMenuConfig) return cachedMenuConfig;
    cachedMenuConfig = loadYamlConfig<MenuConfig>(MENU_YAML_PATH);
    return cachedMenuConfig;
}

export function getAdminConfig(): AdminConfig {
    if (cachedAdminConfig) return cachedAdminConfig;
    cachedAdminConfig = loadYamlConfig<AdminConfig>(ADMIN_YAML_PATH);
    return cachedAdminConfig;
}

export function getDevConfig(): DevConfig {
    if (cachedDevConfig) return cachedDevConfig;
    cachedDevConfig = loadYamlConfig<DevConfig>(DEV_YAML_PATH);
    return cachedDevConfig;
}

function loadYamlConfig<T>(filePath: string): T {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File config tidak ditemukan: ${filePath}`);
        }
        const parsed = yaml.parse(fs.readFileSync(filePath, 'utf-8'));
        return parsed as T;
    } catch (err) {
        log.error({ err, file: path.basename(filePath) }, 'Gagal meload yaml config');
        throw err;
    }
}

// --- Watchers ---

function setupWatcher(filePath: string, updateCache: (parsed: any) => void) {
    try {
        if (fs.existsSync(filePath)) {
            fs.watch(filePath, (eventType) => {
                if (eventType === 'change') {
                    try {
                        const parsed = yaml.parse(fs.readFileSync(filePath, 'utf-8'));
                        updateCache(parsed);
                        log.info(`Reloaded ${path.basename(filePath)} configurations successfully.`);
                    } catch (e) {
                        log.error({ err: e, file: path.basename(filePath) }, 'Error reloading config');
                    }
                }
            });
        }
    } catch (e) {
        log.error({ err: e, file: path.basename(filePath) }, 'Failed to set up watcher');
    }
}

setupWatcher(MENU_YAML_PATH, (parsed) => {
    cachedMenuConfig = parsed;
});

setupWatcher(ADMIN_YAML_PATH, (parsed) => {
    cachedAdminConfig = parsed;
});

setupWatcher(DEV_YAML_PATH, (parsed) => {
    cachedDevConfig = parsed;
});
