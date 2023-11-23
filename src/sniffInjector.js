// ==UserScript==
// @name         WebSocket Injector
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://minesweeper.online/game/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=minesweeper.online
// @grant        none
// @run-at        document-start
// ==/UserScript==

(function() {
    'use strict';
    // Hook onto URL matching this regex
    const injectMatchesTo = /wss?:\/\/(?!chat.+)[a-zA-Z0-9]+\.minesweeper\.online/
    const OrigWebSocket = window.WebSocket

    let forwardServerAlive = true

    // Unused for now, but possibly will be used for injecting HTML to manage sending requests
    function htmlToElement(html) {
        var template = document.createElement('template');
        html = html.trim(); // Never return a text node of whitespace as the result
        template.innerHTML = html;
        return template.content.firstChild;
    }

    function textToBinary(string) {
        return string.split('').map(function (char) {
            return char.charCodeAt(0).toString(2).padStart(8, "0");
        }).join(' ');
    }

    const createId = (() => {
        let next = 0
        return () => { const ret = next; next += 1; return ret }
    })()

    function hookMessage(event) {
        const data = event.data

        forwardToServer(data, "receive")

        const isHeartbeat = data.length === 1
        // I'm not sure what exactly this is, but it clogs up the log
        const isPolling = !!(data.match("W10.w6"))
        if (isHeartbeat || isPolling) {
            return
        }
        console.log(data)

        if (data.match(/^42/)) {
            const body = JSON.parse(data.substring(2))
            const type = body[0]
            if (type === "response") {
                const message = body[1]
                const action = message[0]
                const payload = message[1]
                if (action === "G68.t18") {
                    // [num clicks,
                    // Game ID,
                    // { x, y, time, type: probe|flag|chord, touchCells: [ (x, y, num bombs, ? (1 usually), ? (0 usually))*n ]}
                    // usually null,
                    // bool (idk what for)]
                    // console.log("response", action, payload)
                } else if (action === "G69.i41") {
                    window.mso = { init: payload }
                    // console.log("response (initialization params)", action, payload)
                } else {
                    // console.log("response", action, payload)
                }
            }
        } else {
            // console.log(data)
        }
    }
    function hookOpen(event) {
        console.log("Open:", event)
    }
    function hookClose(event) {
        console.log("Close:", event)
    }
    function hookError(event) {
        console.log("Error:", event)
    }

    function maybeLogData(data) {
        const isHeartbeat = data.length === 1
        // I'm not sure what exactly this is, but it clogs up the log
        const isPolling = !!(data.match("gg131"))
        if (isHeartbeat || isPolling) {
            return
        }
        console.log(data)

        // This payload header seems to correspond to user clicks (probes, flags)
        if (data.match(/^42/)) {
            const body = JSON.parse(data.substring(2))
            const type = body[0]
            if (type === "request") {
                const message = body[1]
                const action = message[0]
                const payload = message[1]
                if (action === "gu57") {
                    // [num clicks,
                    // Game ID,
                    // (probe=0 | flag=1 | chord=2),
                    // x,
                    // y,
                    // time since start in ms,
                    // [ [x,y] ] of tiles to be changed?
                    // black magic string,
                    // usually null,
                    // usually null]
                    // console.log("request", action, payload, data)
                } else {
                    // console.log("request", action, payload)
                }
            }
        } else {
            // console.log(data)
        }
    }

    function forwardToServer(data, direction) {
        if (!data.match(/^42/) || !forwardServerAlive) {
            return
        }

        fetch(
            `http://172.22.85.106:8080/${direction}`, {
                method: "POST",
                cors: 'no-cors',
                headers: {
                    "Content-Type": "application/octet-stream",
                },
                body: data,
            }
        ).catch(e => forwardServerAlive = false) // disable if request fails
    }

    function interceptSend(data, sendFn) {
        // Minesweeper online gets antsy if too many websocket heartbeat messages fail to send
        // and switch to regular HTTP requests for polling and sending messages instead.

        maybeLogData(data)
        forwardToServer(data, "send")

        // As mentioned above, we have to forward heartbeat messages.
        // Alternatively, we can find where the fallback switch happens and just disable it. Maybe
        // server will still accept late data.
        sendFn(data)
    }

    // There's another way to do this so that we don't define a class but it involves a lot of
    // hackery with `.bind`s and stuff. Inheritance is simpler here.
    class WrappedWebSocket extends OrigWebSocket {
        constructor(...args) {
            super(...args)
            this.wrap = this.url.match(injectMatchesTo)
            this.id = createId()
            this.initializeHooks()
        }

        initializeHooks() {
            if (!this.wrap) {
                return
            }
            console.log(`Hooking onto ${this.url} with id ${this.id}`)

            this.addEventListener('message', hookMessage);
            this.addEventListener('open', hookOpen);
            this.addEventListener('close', hookClose);
            this.addEventListener('error', hookError);

            // Let it be accessible to console
            window.snifferIds[this.id] = this
        }

        send(data) {
            if (!this.wrap) {
                super.send(data)
                return
            }
            // console.debug(data)
            // console.trace("Called send")
            interceptSend(data, super.send.bind(this))
        }
    }

    function injectSniffer() {
        console.log('Injecting sniffer')
        window.snifferIds = {}
        window.WebSocket = WrappedWebSocket
    }

    function injectHTML() {
        document.addEventListener("DOMContentLoaded", () => {
            const sniffy = document.createElement("div")
            sniffy.id = "sniffy"
            sniffy.appendChild(document.createTextNode("Sniffy"))
            document.body.insertBefore(sniffy, document.body.childNodes[0])
        })
    }

    injectSniffer()
    // injectHTML()
})();
