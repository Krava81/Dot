import * as cheerio from 'cheerio';
import { universalFetch } from './http';

/**
 * Сервис для извлечения контента из веб-страниц.
 */
export const scraperService = {
  /**
   * Загрузить HTML страницы.
   */
  async fetchUrl(url: string): Promise<string> {
    const response = await universalFetch(url);
    return response.text();
  },

  /**
   * Извлечь основной текстовый контент из HTML.
   */
  async extractContent(html: string): Promise<string> {
    const $ = cheerio.load(html);
    
    // Удаляем лишние элементы
    $('script, style, nav, footer, header, ads, iframe, noscript').remove();
    
    // Извлекаем текст и чистим лишние пробелы
    return $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
  }
};
