const { createLogger, format, transports } = require('winston');

const { combine, timestamp, printf, colorize, errors, json } = format;

const SERVICE_NAME = 'cnk-flight';

const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack, ...meta }) => {
    delete meta.service;
    return stack
      ? `[${timestamp}] ${level}: ${SERVICE_NAME} - ${message}\n${stack}`
      : `[${timestamp}] ${level}: ${SERVICE_NAME} - ${message} ${
          Object.keys(meta).length ? JSON.stringify(meta) : ''
        }`;
  })
);

const logger = createLogger({
  level: 'info',
  format: combine(timestamp(), errors({ stack: true }), json()),
  defaultMeta: { service: SERVICE_NAME },
  transports: [
    new transports.Console({
      format: consoleFormat,
      stderrLevels: ['error'],
      handleExceptions: true,
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
