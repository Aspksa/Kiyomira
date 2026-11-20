import { ПамятьДиалога } from '../02-Память/01-ПамятьДиалога.ts';
import { ОчередьЗадач } from '../03-Задачи/01-ОчередьЗадач.ts';
import type { ПровайдерМодели } from '../04-Модели/01-ПровайдерМодели.ts';

export type СостояниеЯдра = 'создано' | 'работает' | 'остановлено';
export type СобытиеЯдра = { тип: 'запуск' | 'контекст' | 'генерация' | 'сохранение' | 'ответ' | 'ошибка' | 'остановка'; время: number; сведения?: string; диалогИд?: number; источники?: number[] };

export class Ядро {
  readonly задачи = new ОчередьЗадач();
  private состояние: СостояниеЯдра = 'создано';
  private слушатели = new Set<(событие: СобытиеЯдра) => void>();
  private активныхОтветов = 0;

  constructor(private readonly модель: ПровайдерМодели, readonly память = new ПамятьДиалога()) {}

  подписаться(слушатель: (событие: СобытиеЯдра) => void): () => void {
    this.слушатели.add(слушатель);
    return () => this.слушатели.delete(слушатель);
  }

  private сообщить(тип: СобытиеЯдра['тип'], сведения?: string, диалогИд?: number, источники?: number[]): void {
    const событие: СобытиеЯдра = { тип, время: Date.now(), сведения, диалогИд, источники };
    for (const слушатель of this.слушатели) {
      try { слушатель(событие); } catch { /* сбой наблюдателя не ломает ядро */ }
    }
  }

  запустить(): void {
    if (this.состояние !== 'создано') throw new Error('Повторный запуск запрещён');
    this.состояние = 'работает';
    this.сообщить('запуск');
  }

  async ответить(текст: string, диалогИд?: number, сигнал?: AbortSignal): Promise<string> {
    if (this.состояние !== 'работает') throw new Error('Ядро не запущено');
    if (!текст.trim()) throw new Error('Пустое сообщение');
    this.активныхОтветов++;
    try {
      const история = this.память.получить(диалогИд);
      const источники = this.память.источникиКонтекста(диалогИд);
      this.сообщить('контекст', undefined, диалогИд, источники);
      if (сигнал?.aborted) throw new Error('Запрос отменён');
      this.сообщить('генерация', undefined, диалогИд);
      const ответ = await this.модель.создатьОтвет([...история, { роль: 'пользователь', текст }], сигнал);
      if (this.состояние !== 'работает') throw new Error('Ядро остановлено');
      if (сигнал?.aborted) throw new Error('Запрос отменён');
      this.память.добавитьПару(текст, ответ, диалогИд);
      this.сообщить('сохранение', undefined, диалогИд);
      this.сообщить('ответ', undefined, диалогИд);
      return ответ;
    } catch (ошибка) {
      this.сообщить('ошибка', 'Запрос не выполнен', диалогИд);
      throw ошибка;
    } finally {
      this.активныхОтветов--;
    }
  }


  // Stream only complete, source-backed model responses. Persist exactly once
  // after the upstream stream has completed, never on partial/error/cancel.
  async ответитьПотоком(
    текст: string, диалогИд: number|undefined, сигнал: AbortSignal|undefined,
    onChunk:(chunk:string)=>void
  ):Promise<string>{
    if(this.состояние!=='работает')throw new Error('Ядро не запущено');
    if(!текст.trim())throw new Error('Пустое сообщение');
    this.активныхОтветов++;
    try{
      const история=this.память.получить(диалогИд);
      const источники=this.память.источникиКонтекста(диалогИд);
      this.сообщить('контекст',undefined,диалогИд,источники);
      if(сигнал?.aborted)throw new Error('Запрос отменён');
      this.сообщить('генерация',undefined,диалогИд);
      const messages=[...история,{роль:'пользователь' as const,текст}];
      const ответ=this.модель.создатьОтветПотоком
        ? await this.модель.создатьОтветПотоком(messages,сигнал,onChunk)
        : await this.модель.создатьОтвет(messages,сигнал);
      if(!this.модель.создатьОтветПотоком)onChunk(ответ);
      if(this.состояние!=='работает'||сигнал?.aborted)throw new Error('Запрос отменён');
      if(!ответ.trim())throw new Error('Пустой ответ');
      this.память.добавитьПару(текст,ответ,диалогИд);
      this.сообщить('сохранение',undefined,диалогИд);
      this.сообщить('ответ',undefined,диалогИд);
      return ответ;
    }catch(err){this.сообщить('ошибка','Запрос не выполнен',диалогИд);throw err;}
    finally{this.активныхОтветов--;}
  }

  диагностика(): { состояние: СостояниеЯдра; сообщений: number; задач: number; активныхОтветов: number } {
    return { состояние: this.состояние, сообщений: this.память.размер(), задач: this.задачи.размер(), активныхОтветов: this.активныхОтветов };
  }

  async остановить(): Promise<void> {
    if (this.состояние === 'остановлено') return;
    this.состояние = 'остановлено';
    this.задачи.закрыть();
    await this.задачи.дождаться();
    this.сообщить('остановка');
  }
}
