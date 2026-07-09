import { DatabaseSync } from 'node:sqlite';
export const ConfigDB = new DatabaseSync('config.db');

ConfigDB.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id varchar(255) PRIMARY KEY,
    config BLOB CHECK (json_valid(config, 4))
  )
`);
