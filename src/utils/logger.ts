interface Logger {
  info: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

class ConsoleLogger implements Logger {
  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  }

  info(message: string, ...args: any[]): void {
    console.log(this.formatMessage('info', message), ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(this.formatMessage('error', message), ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage('warn', message), ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.formatMessage('debug', message), ...args);
    }
  }
}

export const logger = new ConsoleLogger();

