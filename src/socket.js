#!/bin/env node

import readline from "readline";

import axios from "axios";
import WebSocket from "ws";
import _ from "lodash";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { isMain } from "./lib.js";
import Game, { GameError, GameErrorType } from "./game.js";
import { createPromiseHandlers } from "./lib.js";
import logger from "./logger.js";

export default class GameSocket {
    authKey;
    session;
    userId;
    server;

    ws;
    pinger;

    game;

    #httpHeaders = {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.5",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        Origin: "https://minesweeper.online",
        Referer: "https://minesweeper.online/",
    };

    #fnHandlers;

    constructor({ authKey, session, userId, server }) {
        this.authKey = authKey;
        this.session = session;
        this.userId = userId;
        this.server = server;

        this.#fnHandlers = {
            "G69.i41": this.#handleSyncGame.bind(this),
            "G68.t18": this.#handleClickResponse.bind(this),
            "R35.u43": this.#handleGameOver.bind(this),
        };
    }

    async initSession() {
        logger.debug("Getting sid");
        const sidResponse = await axios({
            method: "GET",
            url: `https://${this.server}.minesweeper.online/mine-websocket/`,
            params: {
                ...this.authParams,
                transport: "polling",
            },
            headers: this.#httpHeaders,
        });
        const jsonData = JSON.parse(sidResponse.data.slice(4, -4));
        this.sid = jsonData.sid;

        // Authorization
        const sidAuthResponse = await axios({
            method: "GET",
            url: `https://${this.server}.minesweeper.online/mine-websocket/`,
            params: {
                ...this.authParams,
                transport: "polling",
                sid: this.sid,
            },
            headers: this.#httpHeaders,
        });
        if (!sidAuthResponse.data.match(/authorized/)) {
            throw new Error("sid not authorized");
        }

        const wsParams = new URLSearchParams({
            ...this.authParams,
            transport: "websocket",
            sid: this.sid,
        });

        logger.debug("Opening websocket");
        const wsUrl = `wss://${
            this.server
        }.minesweeper.online/mine-websocket/?${wsParams.toString()}`;

        this.ws = new WebSocket(wsUrl);
        await this.#addWSEventListeners();
    }

    #addWSEventListeners() {
        const ws = this.ws;

        const { promise, resolve, reject } = createPromiseHandlers();

        ws.on("unexpected-response", (request, response) => {
            logger.debug("unexpected-response");
            this.#clearPinger();
            reject(new Error(response));
        });
        ws.on("upgrade", (response) => {
            logger.debug("upgrading");
        });

        ws.addEventListener("open", () => {
            logger.info("Connection opened");
            ws.send("2probe");
        });
        ws.addEventListener(
            "message",
            (event) => {
                const data = event.data;

                if (data.toString() !== "3probe") {
                    reject(new Error("Failed handshake"));
                } else {
                    ws.send("5");
                    this.#initPinger();
                    resolve();

                    // Add the normal event listener
                    ws.addEventListener("message", this.#onMessage.bind(this));
                }
            },
            { once: true }
        );
        ws.addEventListener("error", (e) => {
            logger.error(e);
        });

        ws.addEventListener("close", (code, reason) => {
            logger.info("Connection closed", code, reason.toString());
        });

        return promise;
    }

    #initPinger() {
        this.#clearPinger();

        const ws = this.ws;
        this.pinger = setInterval(() => {
            ws.send("2");
        }, 2 * 1000);
    }

    #clearPinger() {
        if (this.pinger) {
            clearInterval(this.pinger);
        }
    }

    get authParams() {
        return {
            authKey: this.authKey,
            session: this.session,
            userId: this.userId,
        };
    }

    #onMessage(event) {
        const data = event.data;
        if (data.toString() === "3") {
            // ping message
            return;
        }

        if (data.slice(0, 2) !== "42") {
            logger.error("Received wrong opcode for game");
            return;
        }

        try {
            const jsonArr = JSON.parse(data.slice(2));
            if (jsonArr[0] !== "response") {
                logger.error(`Expected response, got ${jsonArr[0]}`);
                return;
            }
            const fn = jsonArr[1][0];
            const payload = jsonArr[1][1];

            const handler = this.#fnHandlers[fn];
            if (handler) {
                handler(...payload);
            } else {
                logger.warn(`Received unhandled function ${fn}`);
            }
        } catch (err) {
            logger.error(err);
        }
    }

    #handleSyncGame(...args) {
        this.game = new Game(...args);
        logger.info(`Game ${this.game.id} started`);
    }

    #handleClickResponse(...args) {
        this.game.handleClickResponse(...args);
    }

    #handleGameOver(id, __, gameInfo, user, ___, boardOverlays) {
        // TODO: Move this logic into Game
        if (id !== this.game?.id) {
            throw new GameError({
                type: GameErrorType.mismatch,
                message: "Game ID mismatch",
            });
        }

        this.game.gameInfo = gameInfo;
        this.game.boardOverlays = boardOverlays;
    }

    sendGameMessage(fn, payload) {
        const message = `42["request",["${fn}",${JSON.stringify(
            payload
        )},"494"]]`;
        logger.debug(message);
        this.ws.send(message);
    }

    newGame() {
        logger.debug("Starting new game");
        const payload = [
            1,
            null,
            null,
            null,
            null,
            37,
            1,
            null,
            "CA",
            null,
            null,
            null,
            null,
        ];
        this.sendGameMessage("gn16", payload);
    }

    click(clickButton, x, y) {
        const clickMessage = this.game.generateClickMessage(clickButton, x, y);

        this.sendGameMessage("gu57", clickMessage);
    }

    restoreGame(id) {
        id = parseInt(id, 10);
        const payload = [id, null, "CA", 0];

        this.sendGameMessage("gj4", payload);
    }
}

async function main() {
    const parsed = await yargs(hideBin(process.argv))
        .option("auth-key", { type: "string", demandOption: true })
        .option("session", { type: "string", demandOption: true })
        .option("user-id", { type: "string", demandOption: true })
        .option("server", { type: "string", default: "los1" })
        .parse();

    const authKey = parsed.authKey;
    const session = parsed.session;
    const userId = parsed.userId;
    const server = parsed.server;

    const rl = readline.promises.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const socket = new GameSocket({
        authKey,
        session,
        userId,
        server,
    });

    logger.debug("Initializing session");
    await socket.initSession();
    logger.debug("Initialized session");

    while (true) {
        const proc = await rl.question("> ");
        const parts = proc.split(" ");
        if (parts.length === 0) {
            continue;
        }

        const meth = parts[0];

        // for debugging
        if (meth === "eval") {
            eval(parts.slice(1).join(" "));
        }

        if (meth in socket) {
            try {
                socket[meth](...parts.slice(1));
            } catch (err) {
                if (err instanceof GameError) {
                    switch (err.type) {
                        case GameErrorType.noGame:
                            logger.warn("Couldn't complete because no game");
                        case GameErrorType.invalidInput:
                            logger.warn("Invalid input");
                        case GameErrorType.mismatch:
                            logger.warn(err.message);
                    }
                } else {
                    throw err;
                }
            }

            continue;
        }
    }
}

if (isMain(import.meta.url)) {
    main();
}
