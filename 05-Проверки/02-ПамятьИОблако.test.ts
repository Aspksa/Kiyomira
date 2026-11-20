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


test('Cloud.ru запрашивает каталог /v1/models и использует Bearer API key', async () => {
  const подмена: typeof fetch = async (url, параметры) => {
    assert.equal(url, 'https://foundation-models.api.cloud.ru/v1/models');
    assert.equal(параметры?.method, 'GET');
    assert.equal((параметры?.headers as Record<string,string>).Authorization, 'Bearer тест-ключ');
    return new Response(JSON.stringify({data:[{id:'ai-sage/GigaChat3-10B-A1.8B'},{id:'t-tech/T-pro-it-1.0'}]}),{status:200});
  };
  const клиент = new ОблачнаяМодель('тест-ключ','ai-sage/GigaChat3-10B-A1.8B',подмена);
  assert.deepEqual(await клиент.получитьМодели(),['ai-sage/GigaChat3-10B-A1.8B','t-tech/T-pro-it-1.0']);
});

test('Cloud.ru реальный пробный ответ использует 16 токенов и модель, без демо-фолбэка', async () => {
  const подмена: typeof fetch = async (_url, параметры) => {
    const body=JSON.parse(String(параметры?.body));
    assert.equal(body.model,'ai-sage/GigaChat3-10B-A1.8B');
    assert.equal(body.max_tokens,16);
    assert.equal(body.stream,false);
    return new Response(JSON.stringify({choices:[{message:{content:'Готово'}}]}),{status:200});
  };
  const клиент=new ОблачнаяМодель('секрет','ai-sage/GigaChat3-10B-A1.8B',подмена);
  assert.equal(await клиент.создатьОтвет([{роль:'пользователь',текст:'Ответь одним словом'}],undefined,16),'Готово');
});

test('Cloud.ru сообщает точный безопасный код HTTP 429 без секрета', async () => {
  const подмена: typeof fetch=async()=>new Response('Bearer тестовый_секрет_НЕ_ПЕРЕДАВАТЬ',{status:429});
  const клиент=new ОблачнаяМодель('тестовый_секрет_НЕ_ПЕРЕДАВАТЬ','модель',подмена);
  await assert.rejects(клиент.создатьОтвет([{роль:'пользователь',текст:'Привет'}]), e => {
    assert.match((e as Error).message,/HTTP 429/);
    assert.doesNotMatch((e as Error).message,/тестовый_секрет_НЕ_ПЕРЕДАВАТЬ/);
    return true;
  });
});

test('карта памяти: темы, кандидаты противоречий и точные источники контекста', async () => {
  const { определитьТемы, кандидатыПротиворечий } = await import('../02-Память/02-КартаЗнаний.ts');
  assert.equal(определитьТемы('SQLite и проект GitHub').includes('проекты'),true);
  assert.deepEqual(определитьТемы('абракадабра'),['общее']);
  const память=new ПамятьДиалога(50);
  try {
    const id=память.создатьДиалог('Проект Kiyomira');
    память.добавитьПару('Версия: 1.0','Принято',id);
    память.добавитьПару('Версия: 2.0','Изменено',id);
    const map=память.картаДиалогов(3);
    assert.equal(map.сообщения.length,3);
    assert.equal(map.всегоСообщений,4);
    assert.equal(память.источникиКонтекста(id).length,4);
    const candidates=кандидатыПротиворечий(память.картаДиалогов(100).сообщения);
    assert.equal(candidates.length,1);
    assert.equal(candidates[0].тип,'требует проверки');
    assert.equal(candidates[0].ключ,'версия');
  }finally{память.закрыть();}
});
