'use strict';

// Выполняется Node.js. В BAT нет ни вычислений путей, ни вызовов npm.cmd.
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync, appendFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { check } = require('./02-Предпроверка.cjs');

const корень = resolve(__dirname, '..');
const данные = join(корень, '06-Данные');
const журнал = join(данные, 'журнал-запуска.log');
const блокировка = join(данные, 'запуск.lock');
const вход = join(корень, '01-Ядро', '01-Запуск.ts');
let владеемБлокировкой = false;
let содержаниеБлокировки = '';

function журналировать(сообщение) {
  try {
    mkdirSync(данные, { recursive: true });
    if (existsSync(журнал) && statSync(журнал).size > 2097152) {
      for (let i = 3; i >= 1; i--) {
        const before = i === 1 ? журнал : журнал + '.' + (i - 1);
        if (existsSync(before)) {
          const after = журнал + '.' + i;
          if (existsSync(after)) unlinkSync(after);
          require('node:fs').renameSync(before, after);
        }
      }
    }
    appendFileSync(журнал, `[${new Date().toISOString()}] ${сообщение}\n`, 'utf8');
  } catch (ошибка) {
    console.error('Cannot write launcher diagnostics:', ошибка.message);
  }
}

function жив(ид) {
  if (!Number.isSafeInteger(ид) || ид <= 0) return false;
  try {
    process.kill(ид, 0);
    return true;
  } catch (ошибка) {
    return ошибка.code === 'EPERM';
  }
}

function занятьБлокировку() {
  mkdirSync(данные, { recursive: true });
  содержаниеБлокировки = JSON.stringify({ pid: process.pid, token: randomUUID(), дата: Date.now() });
  for (let попытка = 0; попытка < 3; попытка++) {
    try {
      writeFileSync(блокировка, содержаниеБлокировки, { flag: 'wx', encoding: 'utf8' });
      владеемБлокировкой = true;
      return;
    } catch (ошибка) {
      if (ошибка.code !== 'EEXIST') throw ошибка;
      let предыдущий;
      try {
        предыдущий = JSON.parse(readFileSync(блокировка, 'utf8'));
      } catch {
        // Новый процесс мог ещё не успеть завершить запись файла.
        try {
          if (Date.now() - statSync(блокировка).mtimeMs < 10000) {
            throw new Error('Kiyomira уже запускается. Повторный запуск отклонён.');
          }
        } catch (ошибкаФайла) {
          if (ошибкаФайла.code !== 'ENOENT') throw ошибкаФайла;
        }
      }
      if (предыдущий && жив(предыдущий.pid)) {
        throw new Error('Kiyomira уже запущена. Сначала закройте прежнее окно.');
      }
      try { unlinkSync(блокировка); } catch (ошибкаУдаления) {
        if (ошибкаУдаления.code !== 'ENOENT') throw ошибкаУдаления;
      }
    }
  }
  throw new Error('Не удалось получить блокировку запуска');
}

function освободить() {
  if (!владеемБлокировкой) return;
  try {
    if (readFileSync(блокировка, 'utf8') === содержаниеБлокировки) unlinkSync(блокировка);
  } catch (ошибка) {
    if (ошибка.code !== 'ENOENT') журналировать('Ошибка снятия блокировки: ' + ошибка.message);
  }
  владеемБлокировкой = false;
}

async function запустить() {
  const версия = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isSafeInteger(версия) || версия < 24) {
    throw new Error('Нужен Node.js 24+. Найден: ' + process.version);
  }
  if (!existsSync(вход)) throw new Error('Не найден файл ядра: ' + вход);
  занятьБлокировку();
  const readiness = check(корень);
  console.log('[Kiyomira] Предпроверка:', readiness.sqlite === 'ok' ? 'SQLite исправна' : 'Новая база SQLite');
  журналировать('Предпроверка: ' + readiness.sqlite + '; Node ' + process.version);
  const дочерний = spawn(process.execPath, [
    '--experimental-transform-types', вход, '--interactive'
  ], {
    cwd: корень,
    stdio: 'inherit',
    shell: false,
    windowsHide: false,
    env: { ...process.env, KIYOMIRA_INTERACTIVE: '1' }
  });
  return await new Promise((resolvePromise, rejectPromise) => {
    дочерний.once('error', rejectPromise);
    дочерний.once('close', (код, сигнал) => {
      resolvePromise(код === null ? (сигнал ? 130 : 1) : код);
    });
  });
}

запустить()
  .then(код => {
    журналировать('Завершение с кодом ' + код);
    process.exitCode = код;
  })
  .catch(ошибка => {
    const сообщение = ошибка instanceof Error ? ошибка.message : String(ошибка);
    console.error('Ошибка запуска Kiyomira:', сообщение);
    журналировать('Ошибка запуска: ' + сообщение);
    process.exitCode = 1;
  })
  .finally(освободить);
