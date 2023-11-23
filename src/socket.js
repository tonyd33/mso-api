#!/bin/env node

import readline from "readline";
import EventEmitter from "events";

import axios from "axios";
import WebSocket from "ws";
import _ from "lodash";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { isMain, swapKV, createPromiseHandlers } from "./lib.js";
import Game, { GameError, GameErrorType } from "./game.js";
import logger from "./logger.js";

const opcode2Description = {
    "G69.i41": "syncGame",
    "G68.t18": "click",
    "R35.u43": "endGame",
};

const description2Opcode = swapKV(opcode2Description);

/**
 * Socket for Minesweeper Online games.
 * Exposes method for sending raw payloads and also user-friendly methods
 * for common actions.
 */
export default class GameSocket extends EventEmitter {
    authKey;
    session;
    userId;
    server;

    ws;
    pinger;

    // We can multiplex this socket into multiple games, but this makes
    // all public functions require referencing a game id, which is just
    // annoying for the user. Just open another socket for a different game.
    game;

    #httpHeaders = {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.5",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        Origin: "https://minesweeper.online",
        Referer: "https://minesweeper.online/",
    };

    constructor({ authKey, session, userId, server }) {
        super();

        this.authKey = authKey;
        this.session = session;
        this.userId = userId;
        this.server = server;

        this.#addGameLogicListeners();
    }

    /**
     * Opens a WebSocket to Minesweeper Online, returning a promise that
     * resolves after the 3 way handshake for initialization has completed.
     *
     * 1. Request socket id
     * 2. Authorize socket id
     * 3. Establish WebSocket connection
     * 4. WebSocket handshake
     */
    async open() {
        // 1. Request socket id
        logger.debug("Requesting sid");
        const sidResponse = await axios({
            method: "GET",
            url: `https://${this.server}.minesweeper.online/mine-websocket/`,
            params: {
                ...this.#authParams,
                transport: "polling",
            },
            headers: this.#httpHeaders,
        });
        const jsonData = JSON.parse(sidResponse.data.slice(4, -4));
        this.sid = jsonData.sid;

        // 2. Authorize socket id
        const sidAuthResponse = await axios({
            method: "GET",
            url: `https://${this.server}.minesweeper.online/mine-websocket/`,
            params: {
                ...this.#authParams,
                transport: "polling",
                sid: this.sid,
            },
            headers: this.#httpHeaders,
        });
        if (!sidAuthResponse.data.match(/authorized/)) {
            throw new Error("sid not authorized");
        }

        const wsParams = new URLSearchParams({
            ...this.#authParams,
            transport: "websocket",
            sid: this.sid,
        });

        // 3. Establish WebSocket connection
        logger.debug("Opening websocket");
        const wsUrl = `wss://${
            this.server
        }.minesweeper.online/mine-websocket/?${wsParams.toString()}`;

        this.ws = new WebSocket(wsUrl);

        // 4. WebSocket handshake
        await this.#addWSEventListeners();
    }

    async close() {
        this.ws.close();
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

    #addGameLogicListeners() {
        this.on("syncGame", this.#handleSyncGame);
        this.on("click", this.#handleClickResponse);
        this.on("endGame", this.#handleGameOver);
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

                    // Add the normal event listener once this is complete
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

    get #authParams() {
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
            const opcode = jsonArr[1][0];
            const payload = jsonArr[1][1];

            const description = opcode2Description[opcode];
            if (!description || this.listeners(description).length === 0) {
                logger.warn(`Received unhandled opcode ${opcode}`);
            } else {
                this.emit(description, ...payload);
            }
        } catch (err) {
            logger.error(err);
        }
    }

    #handleSyncGame(...args) {
        this.game = new Game(...args);
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
}

class InteractiveGameSocket extends GameSocket {
    constructor(...args) {
        super(...args);

        // These must be called after `GameSocket` handlers
        this.on("syncGame", this.#handleSyncGame);
        this.on("click", this.#handleClickResponse);
        this.on("endGame", this.#handleGameOver);

        const commandHandlers = {
            newGame: this.newGame.bind(this),
            click: this.click.bind(this),
            restoreGame: this.restoreGame.bind(this),
            printBoard: this.printBoard.bind(this),
        };

        this.aliases = {
            ...commandHandlers,
            ng: commandHandlers.newGame,
            c: commandHandlers.click,
            rg: commandHandlers.restoreGame,
            p: commandHandlers.printBoard,
            pb: commandHandlers.printBoard,
        };
    }

    printBoard() {
        logger.info("\n" + this.game.toString(), { raw: true });
    }

    handleCommand(command, args) {
        const fn = this.aliases[command];
        if (!fn) {
            logger.warn("Unknown command");
            return;
        }

        fn(...args);
    }

    #handleSyncGame() {
        logger.info(
            `Game synced.
id: ${this.game.id}
width: ${this.game.sizeX}
height: ${this.game.sizeY}
mines: ${this.game.mines}
timeElapsed: ${this.game.timeElapsed}`,
            { raw: true }
        );
        this.printBoard();
    }

    #handleClickResponse() {
        this.printBoard();
    }

    #handleGameOver() {
        let result;
        const state = this.game.gameInfo.state;
        switch (state) {
            case 2:
                result = "lost";
                break
            case 3:
                result = "won";
                break
            default:
                logger.warn(`Unknown game over state ${state}`);
        }

        if (result) {
            logger.info(`Game complete, you ${result}`);
            this.printBoard();
        }
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
    const socket = new InteractiveGameSocket({
        authKey,
        session,
        userId,
        server,
    });

    logger.debug("Initializing session");
    await socket.open();
    logger.debug("Initialized session");

    rl.on("close", async () => {
        logger.info("Exiting gracefully...");
        await socket.close();
        process.exit(0);
    });

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
            continue
        }

        try {
            socket.handleCommand(meth, parts.slice(1));
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
    }
}

if (isMain(import.meta.url)) {
    main();
}
