import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Роль = 'пользователь' | 'ассистент';
export type Сообщение = Readonly<{ роль: Роль; текст: string }>;
type Строка = { роль: Роль; текст: string };

export class ПамятьДиалога {
  private readonly база: DatabaseSync;
  private readonly вставить;
  constructor(private readonly лимит = 200, путь = ':memory:') {
    if (!Number.isSafeInteger(лимит) || лимит <= 0) throw new Error('Неверный лимит памяти');
    if (путь !== ':memory:') mkdirSync(dirname(путь), { recursive: true });
    this.база = new DatabaseSync(путь);
    this.база.exec('PRAGMA busy_timeout = 5000');
    if (путь !== ':memory:') this.база.exec('PRAGMA journal_mode = WAL');
    this.база.exec(`CREATE TABLE IF NOT EXISTS сообщения (
      ид INTEGER PRIMARY KEY AUTOINCREMENT,
      роль TEXT NOT NULL CHECK (роль IN ('пользователь', 'ассистент')),
      текст TEXT NOT NULL CHECK (length(trim(текст)) > 0),
      время TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    this.вставить = this.база.prepare('INSERT INTO сообщения (роль, текст) VALUES (?, ?)');
  }

  добавить(роль: Роль, текст: string): void {
    if (!текст.trim()) throw new Error('Нельзя сохранить пустое сообщение');
    this.вставить.run(роль, текст);
  }

  добавитьПару(запрос: string, ответ: string): void {
    if (!запрос.trim() || !ответ.trim()) throw new Error('Пустое сообщение');
    this.база.exec('BEGIN IMMEDIATE');
    try {
      this.вставить.run('пользователь', запрос);
      this.вставить.run('ассистент', ответ);
      this.база.exec('COMMIT');
    } catch (ошибка) {
      this.база.exec('ROLLBACK');
      throw ошибка;
    }
  }

  получить(): Сообщение[] {
    const записи = this.база.prepare('SELECT роль, текст FROM сообщения ORDER BY ид DESC LIMIT ?').all(this.лимит) as Строка[];
    return записи.reverse().map(({ роль, текст }) => ({ роль, текст }));
  }
  размер(): number {
    const запись = this.база.prepare('SELECT count(*) AS количество FROM сообщения').get() as { количество: number };
    return запись.количество;
  }
  очистить(): void { this.база.exec('DELETE FROM сообщения'); }
  закрыть(): void { this.база.close(); }
}
