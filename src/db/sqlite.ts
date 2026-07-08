import { DatabaseSync } from 'node:sqlite';
export const settingsDB = new DatabaseSync('db/settings.db');

// 1. Initialize the database with a physical file path for persistence
const dbPath = join(process.cwd(), 'settings.db');
export const SettingsDB = new DatabaseSync(dbPath);
