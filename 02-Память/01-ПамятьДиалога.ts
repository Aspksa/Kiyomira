export type Роль = 'пользователь' | 'ассистент';
export type Сообщение = Readonly<{ роль: Роль; текст: string }>;

export class ПамятьДиалога {
  private записи: Сообщение[] = [];
  constructor(private readonly лимит = 200) {
    if (!Number.isSafeInteger(лимит) || лимит <= 0) throw new Error('Неверный лимит памяти');
  }

  добавить(роль: Роль, текст: string): void {
    if (!текст.trim()) throw new Error('Нельзя сохранить пустое сообщение');
    this.записи.push(Object.freeze({ роль, текст }));
    if (this.записи.length > this.лимит) this.записи.splice(0, this.записи.length - this.лимит);
  }

  получить(): Сообщение[] { return this.записи.map(запись => ({ ...запись })); }
  размер(): number { return this.записи.length; }
  очистить(): void { this.записи = []; }
}
