import { createInterface } from 'node:readline';
import { Ядро } from './02-Управление.ts';
import { ПамятьДиалога } from '../02-Память/01-ПамятьДиалога.ts';
import { ТестоваяМодель } from '../04-Модели/02-ТестоваяМодель.ts';
import { ОблачнаяМодель } from '../04-Модели/03-ОблачнаяМодель.ts';

const ключ = process.env.CLOUD_RU_API_KEY;
const модель = process.env.CLOUD_RU_MODEL;
if (Boolean(ключ) !== Boolean(модель)) throw new Error('Для Cloud.ru укажите и CLOUD_RU_API_KEY, и CLOUD_RU_MODEL');
const демонстрация = !ключ;
const провайдер = демонстрация ? new ТестоваяМодель() : new ОблачнаяМодель(ключ!, модель!);
const память = new ПамятьДиалога(200, process.env.KIYOMIRA_DB_PATH || '06-Данные/память.sqlite');
const ядро = new Ядро(провайдер, память);

async function диалог(): Promise<void> {
  console.log('Kiyomira — интерактивный чат');
  console.log('Для завершения напишите /выход или /exit.');
  const ввод = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  ввод.setPrompt('Вы > ');
  ввод.prompt();
  try {
    for await (const строка of ввод) {
      const текст = строка.trim();
      if (текст === '/выход' || текст === '/exit') break;
      if (текст) {
        try {
          const ответ = await ядро.ответить(текст);
          console.log('Kiyomira >', ответ);
        } catch (ошибка) {
          console.error('Ошибка ответа:', ошибка instanceof Error ? ошибка.message : String(ошибка));
        }
      }
      ввод.prompt();
    }
  } finally {
    ввод.close();
  }
}

try {
  ядро.запустить();
  if (демонстрация) console.log('ДЕМО: тестовая модель, реальный ИИ не подключён');
  const аргументы = process.argv.slice(2);
  const интерактивно = process.env.KIYOMIRA_INTERACTIVE === '1' || аргументы.includes('--interactive');
  if (интерактивно) {
    await диалог();
  } else {
    const текст = аргументы.filter(аргумент => аргумент !== '--interactive').join(' ').trim() || 'Привет, Kiyomira!';
    console.log(await ядро.ответить(текст));
    console.log('Сохранено сообщений:', ядро.диагностика().сообщений);
  }
} finally {
  await ядро.остановить();
  память.закрыть();
}
