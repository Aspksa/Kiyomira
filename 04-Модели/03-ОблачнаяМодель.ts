import type { ПровайдерМодели } from './01-ПровайдерМодели.ts';
import type { Сообщение } from '../02-Память/01-ПамятьДиалога.ts';

type Запрос = typeof fetch;
type ОтветAPI = { choices?: Array<{ message?: { content?: unknown } }> };
export class ОблачнаяМодель implements ПровайдерМодели {
  constructor(
    private readonly ключ: string,
    private readonly модель: string,
    private readonly запрос: Запрос = fetch,
    private readonly адрес = 'https://foundation-models.api.cloud.ru/v1'
  ) {
    if (!ключ.trim() || !модель.trim()) throw new Error('Укажите CLOUD_RU_API_KEY и CLOUD_RU_MODEL');
    const адресAPI = new URL(адрес);
    if (адресAPI.protocol !== 'https:') throw new Error('Для Cloud.ru требуется HTTPS');
  }

  async получитьМодели(): Promise<string[]> {
    const ответ = await this.запрос(`${this.адрес}/models`, {
      headers: { Authorization: `Bearer ${this.ключ}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!ответ.ok) throw new Error(`Cloud.ru: ошибка получения моделей (HTTP ${ответ.status})`);
    const данные = await ответ.json() as { data?: { id: string }[] };
    return (данные.data ?? []).map(модель => модель.id);
  }

  async создатьОтвет(история: readonly Сообщение[], сигнал?: AbortSignal): Promise<string> {
    const ответ = await this.запрос(`${this.адрес}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.ключ}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.модель,
        stream: false,
        messages: история.map(сообщение => ({
          role: сообщение.роль === 'пользователь' ? 'user' : 'assistant',
          content: сообщение.текст
        }))
      }),
      signal: сигнал ? AbortSignal.any([сигнал, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)
    });
    if (!ответ.ok) throw new Error(`Cloud.ru: запрос отклонён (HTTP ${ответ.status})`);
    const данные = await ответ.json() as ОтветAPI;
    const текст = данные.choices?.[0]?.message?.content;
    if (typeof текст !== 'string' || !текст.trim()) throw new Error('Cloud.ru вернул пустой или неверный ответ');
    return текст;
  }
}
