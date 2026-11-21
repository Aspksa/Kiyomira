import type { Сообщение } from '../02-Память/01-ПамятьДиалога.ts';
export type КонтекстМодели = Сообщение | Readonly<{роль:'система';текст:string}>;

export interface ПровайдерМодели {
  создатьОтвет(история: readonly КонтекстМодели[], сигнал?: AbortSignal): Promise<string>;
  создатьОтветПотоком?(история: readonly КонтекстМодели[], сигнал: AbortSignal|undefined, onChunk:(chunk:string)=>void): Promise<string>;
}
