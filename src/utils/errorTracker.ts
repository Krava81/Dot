/**
 * Простой трекер ошибок для отслеживания проблем в рантайме.
 */
class ErrorTracker {
  private errors: Array<{ timestamp: number; error: string; context: string; stack?: string }> = [];

  /**
   * Зафиксировать ошибку.
   * @param error Объект ошибки.
   * @param context Описание места, где произошла ошибка.
   */
  track(error: Error | any, context: string) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    
    this.errors.push({
      timestamp: Date.now(),
      error: errorMsg,
      context,
      stack
    });
    
    // Логируем в консоль для дебага
    console.error(`[ErrorTracker][${context}]`, error);
  }

  /**
   * Получить список всех зафиксированных ошибок.
   */
  getErrors() {
    return [...this.errors].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Очистить историю ошибок.
   */
  clear() {
    this.errors = [];
  }
}

export const errorTracker = new ErrorTracker();
