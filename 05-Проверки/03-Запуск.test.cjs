'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { check } = require('../08-Запуск/02-Предпроверка.cjs');

test('новая база не требуется до запуска', () => {
  const dir = mkdtempSync(join(tmpdir(), 'Рабочий стол & (test) ! ^ % -'));
  try {
    mkdirSync(join(dir, '01-Ядро'));
    mkdirSync(join(dir, '02-Память'));
    writeFileSync(join(dir, '01-Ядро', '01-Запуск.ts'), '');
    writeFileSync(join(dir, '02-Память', '01-ПамятьДиалога.ts'), '');
    assert.equal(check(dir).sqlite, 'new');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('SQLite integrity_check проверяет существующую базу', () => {
  const dir = mkdtempSync(join(tmpdir(), 'киёмиро & (тест) -'));
  try {
    mkdirSync(join(dir, '01-Ядро'));
    mkdirSync(join(dir, '02-Память'));
    mkdirSync(join(dir, '06-Данные'));
    writeFileSync(join(dir, '01-Ядро', '01-Запуск.ts'), '');
    writeFileSync(join(dir, '02-Память', '01-ПамятьДиалога.ts'), '');
    const path = join(dir, '06-Данные', 'память.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE hello(x INTEGER); INSERT INTO hello VALUES (1)');
    db.close();
    assert.equal(check(dir).sqlite, 'ok');
    writeFileSync(path, 'not a database');
    assert.throws(() => check(dir));
    assert.equal(existsSync(path), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
