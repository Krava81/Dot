import fs from 'fs';
import path from 'path';

/**
 * File logger for error tracking
 */
export class FileLogger {
  private logFile: string;
  
  constructor(logDir: string = './logs') {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFile = path.join(logDir, 'app.log');
  }
  
  log(level: 'ERROR' | 'WARN' | 'INFO', message: string) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(this.logFile, line);
  }
}
