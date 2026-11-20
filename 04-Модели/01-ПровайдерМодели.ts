import type { Сообщение } from '../02-Память/01-ПамятьДиалога.ts';

export interface ПровайдерМодели {
  создатьОтвет(история: readonly Сообщение[], сигнал?: AbortSignal): Promise<string>;
  создатьОтветПотоком?(история: readonly Сообщение[], сигнал: AbortSignal|undefined, onChunk:(chunk:string)=>void): Promise<string>;
}
