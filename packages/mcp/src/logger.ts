function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function wallTime(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function isDebugEnabled(): boolean {
  return process.env.QULIB_DEBUG === '1';
}

function emit(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string): void {
  process.stderr.write(`[qulib ${wallTime()}] ${level}  ${message}\n`);
}

export const log = {
  info(message: string): void {
    emit('INFO', message);
  },
  warn(message: string): void {
    emit('WARN', message);
  },
  error(message: string): void {
    emit('ERROR', message);
  },
  debug(message: string): void {
    if (isDebugEnabled()) {
      emit('DEBUG', message);
    }
  },
};
