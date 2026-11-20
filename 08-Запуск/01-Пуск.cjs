'use strict';

// Выполняется Node.js. В BAT нет ни вычислений путей, ни вызовов npm.cmd.
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync, appendFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { check } = require('./02-Предпроверка.cjs');
const { создатьРезервнуюКопию } = require('./03-РезервSQLite.cjs');

const корень = resolve(__dirname, '..');
const данные = join(корень, '06-Данные');
const журнал = join(данные, 'журнал-запуска.log');
const блокировка = join(данные, 'запуск.lock');
const вход = join(корень, '01-Ядро', '01-Запуск.ts');
const веб = join(корень, '08-Запуск', '04-ВебСервер.cjs');
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
  if (readiness.sqlite === 'ok') {
    const копия = await создатьРезервнуюКопию(корень);
    журналировать('Резервная копия SQLite создана: ' + (копия ? 'успешно' : 'нет базы'));
  }
  console.log('[Kiyomira] Предпроверка:', readiness.sqlite === 'ok' ? 'SQLite исправна' : 'Новая база SQLite');
  журналировать('Предпроверка: ' + readiness.sqlite + '; Node ' + process.version);
  const режимCLI = process.env.KIYOMIRA_MODE === 'cli';
  if (!режимCLI && !existsSync(веб)) throw new Error('Не найден локальный веб-сервер Kiyomira');
  const дочерний = spawn(process.execPath, [
    '--experimental-transform-types', режимCLI ? вход : веб,
    ...(режимCLI ? ['--interactive'] : [])
  ], {
    cwd: корень,
    stdio: режимCLI ? 'inherit' : ['inherit','inherit','inherit','ipc'],
    shell: false,
    windowsHide: false,
    env: { ...process.env, KIYOMIRA_INTERACTIVE: режимCLI ? '1' : '0' }
  });
  let сообщениеОГотовности = false;
  let остановкаЗапрошена = false;
  const остановитьДочерний = () => {
    if (остановкаЗапрошена) return;
    остановкаЗапрошена = true;
    if (режимCLI) дочерний.kill('SIGTERM');
    else if (дочерний.connected) дочерний.send({type:'shutdown'});
    else дочерний.kill('SIGTERM');
  };
  process.on('SIGINT', остановитьДочерний);
  process.on('SIGTERM', остановитьДочерний);
  const открыть = url => {
    if (process.env.KIYOMIRA_NO_BROWSER === '1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) return;
    try {
      if (process.platform === 'win32') {
        const p = spawn('powershell.exe',['-NoProfile','-Command','Start-Process','-FilePath',url],{stdio:'ignore',windowsHide:true,detached:true});
        p.unref();
      } else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
        const p = spawn('xdg-open',[url],{stdio:'ignore',detached:true});
        p.on('error',()=>{});
        p.unref();
      }
    } catch { журналировать('Не удалось автоматически открыть браузер'); }
  };
  if (!режимCLI) {
    дочерний.on('message', сообщение => {
      if (сообщение?.type !== 'ready' || сообщениеОГотовности) return;
      сообщениеОГотовности = true;
      журналировать('Веб-сервер готов');
      открыть(сообщение.url);
    });
  }
  return await new Promise((resolvePromise, rejectPromise) => {
    дочерний.once('error', rejectPromise);
    дочерний.once('close', (код, сигнал) => {
      process.off('SIGINT', остановитьДочерний);
      process.off('SIGTERM', остановитьДочерний);
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
