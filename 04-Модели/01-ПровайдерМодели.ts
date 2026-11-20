import type { Сообщение } from '../02-Память/01-ПамятьДиалога.ts';

export interface ПровайдерМодели {
  создатьОтвет(история: readonly Сообщение[], сигнал?: AbortSignal): Promise<string>;
}
