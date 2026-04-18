/**
 * Базовый класс для ошибок обработки AI.
 */
export class AIProcessingError extends Error {
  constructor(message: string, public providerErrors: string[]) {
    super(message);
    this.name = 'AIProcessingError';
  }
}

/**
 * Ошибка валидации контента.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
