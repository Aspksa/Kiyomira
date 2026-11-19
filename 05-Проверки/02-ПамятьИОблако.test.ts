import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ПамятьДиалога } from '../02-Память/01-ПамятьДиалога.ts';
import { Ядро } from '../01-Ядро/02-Управление.ts';
import { ОблачнаяМодель } from '../04-Модели/03-ОблачнаяМодель.ts';
import { ТестоваяМодель } from '../04-Модели/02-ТестоваяМодель.ts';

test('SQLite восстанавливает диалог после повторного открытия', async () => {
  const папка = mkdtempSync(join(tmpdir(), 'kiyomira-'));
  const путь = join(папка, 'память.sqlite');
  try {
    const первая = new ПамятьДиалога(2, путь);
    const ядро = new Ядро(new ТестоваяМодель(), первая);
    ядро.запустить();
    await ядро.ответить('первое сообщение');
    await ядро.остановить();
    первая.закрыть();
    const вторая = new ПамятьДиалога(2, путь);
    assert.equal(вторая.размер(), 2);
    assert.deepEqual(вторая.получить().map(x => x.роль), ['пользователь', 'ассистент']);
    вторая.закрыть();
  } finally { rmSync(папка, { recursive: true, force: true }); }
});

test('ошибка модели не сохраняет половину диалога', async () => {
  const память = new ПамятьДиалога();
  const ядро = new Ядро({ async создатьОтвет() { throw new Error('нет ответа'); } }, память);
  ядро.запустить();
  await assert.rejects(ядро.ответить('вопрос'), /нет ответа/);
  assert.equal(память.размер(), 0);
  await ядро.остановить();
  память.закрыть();
});

test('Cloud.ru отправляет правильный запрос без реального API-вызова', async () => {
  let проверено = false;
  const подмена: typeof fetch = async (url, параметры) => {
    assert.equal(url, 'https://foundation-models.api.cloud.ru/v1/chat/completions');
    assert.equal((параметры?.headers as Record<string, string>).Authorization, 'Bearer тест-ключ');
    const тело = JSON.parse(String(параметры?.body));
    assert.equal(тело.model, 'тест-модель');
    assert.equal(тело.messages[0].role, 'user');
    проверено = true;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Ответ Cloud.ru' } }] }), { status: 200 });
  };
  const клиент = new ОблачнаяМодель('тест-ключ', 'тест-модель', подмена);
  assert.equal(await клиент.создатьОтвет([{ роль: 'пользователь', текст: 'Привет' }]), 'Ответ Cloud.ru');
  assert.equal(проверено, true);
});

test('Cloud.ru не раскрывает ключ при ошибке HTTP', async () => {
  const подмена: typeof fetch = async () => new Response('ошибка', { status: 401 });
  const клиент = new ОблачнаяМодель('секрет', 'модель', подмена);
  await assert.rejects(клиент.создатьОтвет([{ роль: 'пользователь', текст: 'Привет' }]), /HTTP 401/);
});
