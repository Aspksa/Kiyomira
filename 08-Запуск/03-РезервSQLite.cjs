'use strict';

// Согласованные SQLite-копии: никогда не копировать основной файл в режиме WAL обычным copyFile.
const { backup, DatabaseSync } = require('node:sqlite');
const { existsSync, mkdirSync, renameSync, unlinkSync, readdirSync } = require('node:fs');
const { dirname, basename, join, resolve } = require('node:path');
const { randomUUID } = require('node:crypto');

async function создатьРезервнуюКопию(корень = resolve(__dirname, '..'), путьБазы) {
  const путь = resolve(корень, путьБазы || process.env.KIYOMIRA_DB_PATH || '06-Данные/память.sqlite');
  if (!existsSync(путь)) return null;
  const папка = join(dirname(путь), 'резервные-копии');
  mkdirSync(папка, { recursive: true });
  const имя = basename(путь).replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '_');
  const префикс = имя + '-';
  const отметка = new Date().toISOString().replace(/[:.]/g, '-');
  const результат = join(папка, префикс + отметка + '-' + randomUUID() + '.sqlite');
  const временный = результат + '.незавершено';
  const база = new DatabaseSync(путь, { readOnly: true });
  try {
    await backup(база, временный);
  } catch (ошибка) {
    throw new Error('Не удалось сохранить резервную копию SQLite: ' + (ошибка instanceof Error ? ошибка.message : String(ошибка)));
  } finally {
    база.close();
  }
  try {
    const проверка = new DatabaseSync(временный, { readOnly: true });
    try {
      const итог = проверка.prepare('PRAGMA integrity_check').all();
      if (итог.length !== 1 || итог[0].integrity_check !== 'ok') {
        throw new Error('Резервная копия не прошла проверку целостности');
      }
    } finally {
      проверка.close();
    }
    renameSync(временный, результат);
    const копии = readdirSync(папка).filter(название => название.startsWith(префикс) && название.endsWith('.sqlite')).sort();
    for (const устаревшая of копии.slice(0, Math.max(0, копии.length - 5))) {
      unlinkSync(join(папка, устаревшая));
    }
    return результат;
  } finally {
    if (existsSync(временный)) unlinkSync(временный);
  }
}
module.exports = { создатьРезервнуюКопию };
