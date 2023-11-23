import winston from "winston";

const logger = winston.createLogger({
    level: process.env["LOG_LEVEL"] || "info",
    format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.colorize(),
        winston.format.timestamp({ format: "YYYY-MM-DD hh:mm:ss.SSS A" }),
        winston.format.printf((info) => {
            if (info.raw) {
                return info.message;
            }

            const stackInfo = info.stack ? `\n${info.stack}` : "";
            const scopeStr = info.scope ? `[${info.scope}] ` : "";
            const levelPadded = info.level.padStart(15, " ");

            return `${levelPadded}: ${scopeStr}${info.message}${stackInfo}`;
            // return `${info.timestamp} ${levelPadded}: ${scopeStr}${info.message}${stackInfo}`;
        })
    ),
    transports: [new winston.transports.Console()],
});

export default logger;
