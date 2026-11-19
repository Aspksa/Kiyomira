'use strict';
const { DatabaseSync } = require('node:sqlite');
const { existsSync, accessSync, constants, mkdirSync, writeFileSync, unlinkSync } = require('node:fs');
const { join, resolve } = require('node:path');
function check(root = resolve(__dirname, '..')) {
  const entry = join(root, '01-Ядро', '01-Запуск.ts');
  const memory = join(root, '02-Память', '01-ПамятьДиалога.ts');
  const data = join(root, '06-Данные');
  if (!existsSync(entry) || !existsSync(memory)) throw Error('Не найдены основные файлы TypeScript');
  mkdirSync(data, { recursive: true });
  const probe = join(data, 'проверка-записи-' + process.pid);
  try { writeFileSync(probe, 'ok', { flag: 'wx' }); } finally { if (existsSync(probe)) unlinkSync(probe); }
  const dbPath = resolve(root, process.env.KIYOMIRA_DB_PATH || '06-Данные/память.sqlite');
  if (!existsSync(dbPath)) return { sqlite: 'new', source: 'ok' };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const result = db.prepare('PRAGMA integrity_check').all();
    if (result.length !== 1 || result[0].integrity_check !== 'ok') {
      throw Error('SQLite повреждена. База не изменена. Нужна безопасная диагностика.');
    }
    return { sqlite: 'ok', source: 'ok' };
  } finally { db.close(); }
}
if (require.main === module) {
  try { console.log(JSON.stringify(check())); } catch (error) { console.error(String(error.message)); process.exitCode = 1; }
}
module.exports = { check };
