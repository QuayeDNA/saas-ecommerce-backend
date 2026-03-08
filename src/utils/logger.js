import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
    const extras = Object.keys(meta).length
        ? ' ' + JSON.stringify(meta, (_k, v) =>
            v instanceof Error ? { message: v.message, stack: v.stack } : v
          )
        : '';
    return `${timestamp} [${level}]: ${message}${extras}`;
});

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
    format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    transports: [new winston.transports.Console()]
});

export default logger;
