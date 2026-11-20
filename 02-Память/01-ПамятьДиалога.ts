import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Роль = 'пользователь' | 'ассистент';
export type Сообщение = Readonly<{ роль: Роль; текст: string }>;
type Строка = { роль: Роль; текст: string };
type Запись = Строка & { ид: number; время: string };
type Диалог = { ид: number; название: string; обновлено: string; сообщений: number };

export class ПамятьДиалога {
  private readonly база: DatabaseSync;
  private readonly вставить;
  private readonly вставитьВДиалог;

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
    // Non-destructive migration: all existing CLI dialogue remains in SQLite.
    this.база.exec(`CREATE TABLE IF NOT EXISTS диалоги (
      ид INTEGER PRIMARY KEY AUTOINCREMENT,
      название TEXT NOT NULL,
      создано TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      обновлено TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const колонки = this.база.prepare('PRAGMA table_info(сообщения)').all() as { name: string }[];
    if (!колонки.some(колонка => колонка.name === 'диалог_ид')) {
      this.база.exec('ALTER TABLE сообщения ADD COLUMN диалог_ид INTEGER');
    }
    this.база.exec('CREATE INDEX IF NOT EXISTS idx_сообщения_диалог ON сообщения(диалог_ид, ид)');
    this.база.exec('CREATE TABLE IF NOT EXISTS веб_настройки (ключ TEXT PRIMARY KEY, значение TEXT NOT NULL)');
    this.база.exec('BEGIN IMMEDIATE');
    try {
      const старых = this.база.prepare('SELECT count(*) AS n FROM сообщения WHERE диалог_ид IS NULL').get() as { n: number };
      if (старых.n) {
        this.база.exec("INSERT OR IGNORE INTO диалоги(ид, название) VALUES (1, 'История до веб-версии')");
        this.база.exec('UPDATE сообщения SET диалог_ид = 1 WHERE диалог_ид IS NULL');
      }
      this.база.exec('COMMIT');
    } catch (ошибка) {
      this.база.exec('ROLLBACK');
      throw ошибка;
    }
    this.вставить = this.база.prepare('INSERT INTO сообщения (роль, текст) VALUES (?, ?)');
    this.вставитьВДиалог = this.база.prepare('INSERT INTO сообщения (роль, текст, диалог_ид) VALUES (?, ?, ?)');
  }

  добавить(роль: Роль, текст: string): void {
    if (!текст.trim()) throw new Error('Нельзя сохранить пустое сообщение');
    this.вставить.run(роль, текст);
  }

  добавитьПару(запрос: string, ответ: string, диалогИд?: number): void {
    if (!запрос.trim() || !ответ.trim()) throw new Error('Пустое сообщение');
    if (диалогИд !== undefined && !this.существуетДиалог(диалогИд)) throw new Error('Диалог не найден');
    this.база.exec('BEGIN IMMEDIATE');
    try {
      if (диалогИд === undefined) {
        this.вставить.run('пользователь', запрос);
        this.вставить.run('ассистент', ответ);
      } else {
        this.вставитьВДиалог.run('пользователь', запрос, диалогИд);
        this.вставитьВДиалог.run('ассистент', ответ, диалогИд);
        this.база.prepare('UPDATE диалоги SET обновлено=CURRENT_TIMESTAMP WHERE ид=?').run(диалогИд);
      }
      this.база.exec('COMMIT');
    } catch (ошибка) {
      this.база.exec('ROLLBACK');
      throw ошибка;
    }
  }

  получить(диалогИд?: number): Сообщение[] {
    const записи = диалогИд === undefined
      ? this.база.prepare('SELECT роль, текст FROM сообщения ORDER BY ид DESC LIMIT ?').all(this.лимит) as Строка[]
      : this.база.prepare('SELECT роль, текст FROM сообщения WHERE диалог_ид=? ORDER BY ид DESC LIMIT ?').all(диалогИд, this.лимит) as Строка[];
    return записи.reverse().map(({ роль, текст }) => ({ роль, текст }));
  }

  существуетДиалог(ид: number): boolean {
    return Number.isSafeInteger(ид) && ид > 0 && Boolean(this.база.prepare('SELECT ид FROM диалоги WHERE ид=?').get(ид));
  }

  создатьДиалог(название = 'Новый диалог'): number {
    const очищенное = название.trim().slice(0, 100);
    if (!очищенное) throw new Error('Название диалога не может быть пустым');
    const результат = this.база.prepare('INSERT INTO диалоги(название) VALUES(?)').run(очищенное);
    return Number(результат.lastInsertRowid);
  }

  списокДиалогов(): Диалог[] {
    return this.база.prepare(`SELECT д.ид, д.название, д.обновлено, count(с.ид) AS сообщений
      FROM диалоги д LEFT JOIN сообщения с ON с.диалог_ид=д.ид
      GROUP BY д.ид ORDER BY д.обновлено DESC, д.ид DESC LIMIT 250`).all() as Диалог[];
  }

  сообщенияДиалога(ид: number): Запись[] {
    if (!this.существуетДиалог(ид)) throw new Error('Диалог не найден');
    return (this.база.prepare('SELECT ид, роль, текст, время FROM сообщения WHERE диалог_ид=? ORDER BY ид DESC LIMIT 200').all(ид) as Запись[]).reverse();
  }

  переименоватьДиалог(ид: number, название: string): void {
    if (!this.существуетДиалог(ид)) throw new Error('Диалог не найден');
    const очищенное = название.trim().slice(0, 100);
    if (!очищенное) throw new Error('Пустое название');
    this.база.prepare('UPDATE диалоги SET название=? WHERE ид=?').run(очищенное, ид);
  }

  удалитьДиалог(ид: number): void {
    if (!this.существуетДиалог(ид)) throw new Error('Диалог не найден');
    this.база.exec('BEGIN IMMEDIATE');
    try {
      this.база.prepare('DELETE FROM сообщения WHERE диалог_ид=?').run(ид);
      this.база.prepare('DELETE FROM диалоги WHERE ид=?').run(ид);
      this.база.exec('COMMIT');
    } catch (ошибка) { this.база.exec('ROLLBACK'); throw ошибка; }
  }

  поиск(запрос: string): { диалог_ид: number; название: string; текст: string; роль: Роль }[] {
    const needle = запрос.trim().toLocaleLowerCase('ru').slice(0, 100);
    if (needle.length < 2) return [];
    // JavaScript Unicode case folding also works for Cyrillic; SQLite's lower() normally does not.
    const записи = this.база.prepare(`SELECT с.диалог_ид, д.название, с.текст, с.роль
      FROM сообщения с JOIN диалоги д ON д.ид=с.диалог_ид ORDER BY с.ид DESC LIMIT 5000`)
      .all() as { диалог_ид: number; название: string; текст: string; роль: Роль }[];
    return записи.filter(запись => запись.текст.toLocaleLowerCase('ru').includes(needle) ||
      запись.название.toLocaleLowerCase('ru').includes(needle))
      .slice(0, 50).map(запись => ({ ...запись, текст: запись.текст.slice(0, 240) }));
  }

  настройка(ключ: string): string | null {
    const запись = this.база.prepare('SELECT значение FROM веб_настройки WHERE ключ=?').get(ключ) as { значение: string } | undefined;
    return запись?.значение ?? null;
  }
  установитьНастройку(ключ: string, значение: string): void {
    if (ключ !== 'модель') throw new Error('Этот параметр нельзя сохранять');
    this.база.prepare('INSERT INTO веб_настройки (ключ, значение) VALUES (?, ?) ON CONFLICT(ключ) DO UPDATE SET значение=excluded.значение').run(ключ, значение);
  }

  размер(): number {
    const запись = this.база.prepare('SELECT count(*) AS количество FROM сообщения').get() as { количество: number };
    return запись.количество;
  }
  очистить(): void { this.база.exec('DELETE FROM сообщения'); }
  закрыть(): void { this.база.close(); }
}
