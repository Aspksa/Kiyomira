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
try {
  ядро.запустить();
  if (демонстрация) console.log('ДЕМО: тестовая модель, реальный ИИ не подключён');
  const текст = process.argv.slice(2).join(' ').trim() || 'Привет, Kiyomira!';
  console.log(await ядро.ответить(текст));
  console.log('Сохранено сообщений:', ядро.диагностика().сообщений);
} finally {
  await ядро.остановить();
  память.закрыть();
}
