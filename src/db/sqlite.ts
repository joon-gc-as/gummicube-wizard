import { DatabaseSync } from 'node:sqlite';
export const SettingsDB = new DatabaseSync('settings.db');

SettingsDB.exec(`
CREATE TABLE IF NOT EXISTS settings (
id varchar(255) PRIMARY KEY
model varchar(255) not null 
max_tokens INTEGER not null
max_iterations INTEGER not null
)
`);
