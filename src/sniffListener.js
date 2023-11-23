import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import winston from "winston";

const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD hh:mm:ss.SSS A" }),
        winston.format.printf((info) => `${info.timestamp}\n${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "sniff.log" }),
    ],
});

const app = express();
const port = 8080;

app.use(cors());
app.use(bodyParser.json());

app.post("/send", (req, res) => {
    logger.info(req.body);
    res.json({ success: true });
});

app.post("/receive", (req, res) => {
    logger.info(req.body);
    res.json({ success: true });
});

app.listen(port, () => {
    logger.info(`listening on port ${port}`);
});
