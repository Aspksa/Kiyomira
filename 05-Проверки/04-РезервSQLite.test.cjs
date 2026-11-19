'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync, readdirSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { создатьРезервнуюКопию } = require('../08-Запуск/03-РезервSQLite.cjs');

test('Резерв SQLite содержит подтверждённые данные WAL и ограничивается 5 копиями', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'Рабочий стол & (SQLite) ! -'));
  const dbFile = join(dir, 'память.sqlite');
  const db = new DatabaseSync(dbFile);
  try {
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('CREATE TABLE записи (текст TEXT)');
    db.prepare('INSERT INTO записи VALUES (?)').run('данные не потеряны');
    for (let i=0; i<7; i++) {
      const path = await создатьРезервнуюКопию(dir, dbFile);
      assert.equal(existsSync(path), true);
      const saved = new DatabaseSync(path, {readOnly:true});
      try {
        assert.equal(saved.prepare('SELECT текст FROM записи').get().текст, 'данные не потеряны');
        assert.equal(saved.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      } finally { saved.close(); }
    }
    assert.equal(readdirSync(join(dir, 'резервные-копии')).filter(f=>f.endsWith('.sqlite')).length, 5);
  } finally {
    db.close();
    rmSync(dir, {recursive:true,force:true});
  }
});

test('Отсутствующая SQLite не создаётся при резервном копировании', async () => {
  const dir=mkdtempSync(join(tmpdir(), 'киёмиро-'));
  try {
    assert.equal(await создатьРезервнуюКопию(dir), null);
    assert.equal(existsSync(join(dir,'06-Данные','память.sqlite')),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
