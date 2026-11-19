export type Задача = () => Promise<void> | void;
export class ОчередьЗадач {
  private хвост: Promise<void> = Promise.resolve();
  private ожидают = 0;
  private закрыта = false;
  private ошибки: string[] = [];

  добавить(задача: Задача): Promise<void> {
    if (this.закрыта) return Promise.reject(new Error('Очередь закрыта'));
    this.ожидают++;
    const выполнение = this.хвост.then(async () => { await задача(); });
    this.хвост = выполнение.catch(ошибка => { this.ошибки.push(String(ошибка)); }).finally(() => { this.ожидают--; });
    return выполнение;
  }

  размер(): number { return this.ожидают; }
  последниеОшибки(): string[] { return [...this.ошибки]; }
  закрыть(): void { this.закрыта = true; }
  async дождаться(): Promise<void> { await this.хвост; }
}
