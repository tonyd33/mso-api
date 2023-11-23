import _ from "lodash";

const clickTypes = {
    probe: 0,
    flag: 1,
    chord: 3,
};

const clickButtons = {
    leftClick: 0,
    rightClick: 1,
};

const clickButtonAliases = {
    ...clickButtons,
    lc: clickButtons.leftClick,
    l: clickButtons.leftClick,

    rc: clickButtons.rightClick,
    r: clickButtons.rightClick,
};

export default class Game {
    gameInfo;
    boardOverlays;
    history;

    constructor(gameInfo, boardOverlays, history, __, ___, ____) {
        this.gameInfo = gameInfo;
        this.boardOverlays = boardOverlays;
        this.history = history;
    }

    get id() {
        return this.gameInfo.id;
    }

    get sizeX() {
        return this.gameInfo.sizeX;
    }

    get sizeY() {
        return this.gameInfo.sizeY;
    }

    get mines() {
        return this.gameInfo.mines;
    }

    get clickNum() {
        return this.history.length;
    }

    get isActive() {
        return !!this.gameInfo.timeStart;
    }

    start() {
        this.gameInfo.timeStart = Date.now();
    }

    get timeElapsed() {
        return this.isActive ? Date.now() - this.gameInfo.timeStart : null;
    }

    #coord2Idx(x, y) {
        return this.sizeY * x + y;
    }

    #nbrCoords(x, y) {
        const dim = this.sizeX * this.sizeY;
        return [
            [x - 1, y - 1],
            [x, y - 1],
            [x + 1, y - 1],
            [x + 1, y],
            [x + 1, y + 1],
            [x, y + 1],
            [x - 1, y + 1],
            [x - 1, y],
        ].filter(([cx, cy]) => {
            const idx = this.#coord2Idx(cx, cy);
            return 0 <= idx && idx < dim;
        });
    }

    #nbrIdxs(x, y) {
        return this.#nbrCoords(x, y).map((...coords) =>
            this.#coord2Idx(...coords)
        );
    }

    #getTouchCells(clickType, x, y) {
        const idx = this.#coord2Idx(x, y);
        switch (clickType) {
            case clickTypes.probe:
            case clickTypes.flag:
                return [[x, y]];
            case clickTypes.chord:
                const neighbors = this.#nbrCoords(x, y);

                const numBombs = this.boardOverlays.t[idx];
                const numNeighborFlagged = neighbors.filter(
                    ([nx, ny]) =>
                        !!this.boardOverlays.f[this.#coord2Idx(nx, ny)]
                ).length;
                // This is how Minesweeper Online does it
                if (numBombs !== numNeighborFlagged) {
                    return [];
                }

                // Return the non-flagged and non-opened tiles
                return neighbors.filter(([nx, ny]) => {
                    const idx = this.#coord2Idx(nx, ny);
                    const isOpen = !!this.boardOverlays.o[idx];
                    const isFlagged = !!this.boardOverlays.f[idx];
                    return !isOpen && !isFlagged;
                });
            default:
                throw new GameError({ type: GameErrorType.invalidInput });
        }
    }

    #button2ClickType(clickButton, x, y) {
        if (clickButton === clickButtons.rightClick) {
            return clickTypes.flag;
        } else if (clickButton === clickButtons.leftClick) {
            const idx = this.#coord2Idx(x, y);
            const isOpen = !!this.boardOverlays.o[idx];
            const isFlagged = !!this.boardOverlays.f[idx];

            if (isFlagged) {
                throw new GameError({ type: GameErrorType.invalidInput });
            }

            return isOpen ? clickTypes.chord : clickTypes.probe;
        }
        throw new GameError({ type: GameErrorType.invalidInput });
    }

    generateClickMessage(clickButtonStr, x, y) {
        try {
            x = parseInt(x, 10);
            y = parseInt(y, 10);
        } catch (err) {
            throw new GameError({ type: GameErrorType.invalidInput });
        }

        const clickButton = clickButtonAliases[clickButtonStr];
        const clickType = this.#button2ClickType(clickButton, x, y);

        if (!this.isActive) this.start();

        const payloadJSON = [
            this.clickNum,
            this.gameInfo.id,
            clickType,
            x,
            y,
            this.timeElapsed,
            this.#getTouchCells(clickType, x, y),
            "",
            null,
            null,
        ];

        return payloadJSON;
    }

    handleClickResponse(clickNum, gameId, updateInfo, __, ___) {
        if (gameId !== this.gameInfo.id) {
            throw new GameError({
                type: GameErrorType.mismatch,
                message: "Game ID mismatch",
            });
        }
        if (clickNum !== this.clickNum) {
            throw new GameError({
                type: GameErrorType.mismatch,
                message: "Click numbers mismatch",
            });
        }

        this.history.push(updateInfo);
        this.gameInfo.requests.push(updateInfo.time);

        const cells = _.chunk(updateInfo.touchCells, 5);
        for (const [x, y, nb, opened, flagged] of cells) {
            const index = this.#coord2Idx(x, y);
            this.boardOverlays.t[index] = opened ? nb : 0;
            this.boardOverlays.o[index] = opened;
            this.boardOverlays.f[index] = flagged;
        }
    }

    toString() {
        let str = "";
        const { sizeX, sizeY } = this.gameInfo;
        const { t, o, f } = this.boardOverlays;

        for (let y = 0; y < sizeY; y++) {
            for (let x = 0; x < sizeX; x++) {
                const index = sizeY * x + y;
                const opened = !!o[index];
                const flagged = !!f[index];
                if (opened) {
                    const v = t[index];
                    if (v === 0) {
                        str += ".";
                    } else if (v === 11) {
                        // Bomb, you clicked this
                        // str += "💥"
                        str += "B";
                    } else if (v === 10) {
                        // Bomb, you didn't click this
                        // str += "💣"
                        str += "b";
                    } else {
                        str += t[index].toString();
                    }
                } else if (flagged) {
                    str += "f";
                } else {
                    str += "x";
                }
            }
            str += "\n";
        }
        return str;
    }
}

export class GameError extends Error {
    constructor({ message, type }) {
        super(message);
        this.type = type;
    }
}

export const GameErrorType = {
    noGame: 0,
    invalidInput: 1,
    mismatch: 2,
};
