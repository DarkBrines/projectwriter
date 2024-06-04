import type { ServerWebSocket } from "bun";
import { randomBytes } from "crypto";

const readerHTMLFile = Bun.file("./www/reader.html");
const writerHTMLFile = Bun.file("./www/writer.html");

enum WebSocketType {
    Reader,
    Writer
}

type SessionData = {
    id: string;
    type: WebSocketType;
    remoteAddr: string;
    openedBoard?: string;
}

type Board = {
    id: string;
    name: string;
    content: string;
    readerSessions: string[];
    writer: string;
}

const writers: Map<string, { sessions: string[], boards: string[] }> = new Map();
const boards: Map<string, Board> = new Map();

const websocketsClients: Map<string, ServerWebSocket<SessionData>> = new Map();

function generateID() {
    return randomBytes(16).toString('hex');
}

function broadcastWebsockets(sessions: string[], data: any, except?: string) {
    sessions.forEach((wsid) => {
        if (wsid === except) return;

        const ws = websocketsClients.get(wsid)
        if (!ws) return;
        ws.send(JSON.stringify(data))
    })
}

const listenAddr = process.env.LISTEN_ADDR ?? "0.0.0.0";
let listenPort = Number(process.env.LISTEN_PORT);
if (isNaN(listenPort) || !isFinite(listenPort)) {
    listenPort = 8080;
}

const server = Bun.serve<SessionData>({
    hostname: listenAddr,
    port: listenPort,
    fetch(req) {
        const url = new URL(req.url);
        const p = url.pathname;

        const sockAddr = this.requestIP(req);
        const remoteAddr = sockAddr?.address + ":" + sockAddr?.port

        if (p.startsWith("/ws/r")) {
            const id = url.searchParams.get("id");
            if (id === null)
                return new Response("Missing ID", { status: 400 });

            server.upgrade(req, {
                data: {
                    id,
                    type: WebSocketType.Reader,
                    remoteAddr
                }
            })
            return undefined;
        }

        else if (p.startsWith("/ws/w")) {
            const id = url.searchParams.get("id");
            if (id === null)
                return new Response("Missing ID", { status: 400 });

            server.upgrade(req, {
                data: {
                    id,
                    type: WebSocketType.Writer,
                    remoteAddr
                }
            });
            return undefined;
        }

        else if (p.startsWith("/w"))
            return new Response(writerHTMLFile);

        else if (p.startsWith("/r"))
            return new Response(readerHTMLFile);

        else if (p == "/")
            return new Response("Redirecting...", {
                status: 302, headers: {
                    "Location": "/w/#" + generateID()
                }
            })

        return new Response("Not found", { status: 404 });
    },
    websocket: {
        open(ws) {
            if (ws.data.type == WebSocketType.Reader) {
                const b = boards.get(ws.data.id);
                if (b === undefined)
                    return ws.close(404, "Board not found")

                websocketsClients.set(ws.data.remoteAddr, ws)
            } else {
                let w = writers.get(ws.data.id);
                if (w === undefined) {
                    w = { boards: [], sessions: [] }
                    writers.set(ws.data.id, w)
                }

                websocketsClients.set(ws.data.remoteAddr, ws)
                w.sessions.push(ws.data.remoteAddr);
            }
        },
        message(ws, message) {
            let data;
            if (message instanceof Buffer)
                data = JSON.parse(message.toString('utf-8'))
            else
                data = JSON.parse(message)

            const cmd = Number(data["cmd"])
            if (isNaN(cmd) || !isFinite(cmd)) {
                return;
            }

            const res: any = { cmd };

            // Get owned boards
            if (cmd == 1 && ws.data.type == WebSocketType.Writer) {
                const w = writers.get(ws.data.id)
                res["boards"] = []
                w?.boards.forEach((boardid: string) => {
                    res["boards"].push({
                        id: boardid,
                        name: boards.get(boardid)?.name
                    })
                })
            }

            // Create a board
            else if (cmd == 2 && ws.data.type == WebSocketType.Writer) {
                const name = data["board_name"]
                if (!name) {
                    return;
                }

                const boardid = generateID();
                const w = writers.get(ws.data.id);
                if (!w) return;

                boards.set(boardid, {
                    content: name,
                    id: boardid,
                    name,
                    readerSessions: [],
                    writer: ws.data.id
                });

                w.boards.push(boardid);

                broadcastWebsockets(w.sessions, { cmd: 2, board_id: boardid, board_name: name }, ws.data.remoteAddr);
                res["board_id"] = boardid;
                res["board_name"] = name;
                res["update_ui"] = true;
            }

            // Read a board
            else if (cmd == 3) {
                let boardid;
                if (ws.data.type == WebSocketType.Writer) {
                    boardid = data["board_id"];
                    if (!boardid)
                        return;
                } else {
                    boardid = ws.data.id;
                }

                const b = boards.get(boardid);
                if (!b) return;

                if (ws.data.openedBoard) {
                    const openedBoard = boards.get(ws.data.openedBoard);
                    if (openedBoard) {
                        const i = openedBoard.readerSessions.indexOf(ws.data.remoteAddr);
                        if (i > -1)
                            delete openedBoard.readerSessions[i];
                    }
                }

                b.readerSessions.push(ws.data.remoteAddr);
                ws.data.openedBoard = boardid;

                res["content"] = b.content;
                res["board_name"] = b.name;
            }

            // Write a board
            else if (cmd == 4 && ws.data.type == WebSocketType.Writer) {
                const boardid = data["board_id"];
                if (!boardid) return;

                const b = boards.get(boardid);
                if (!b) return;

                b.content = data["content"];

                const w = writers.get(ws.data.id);
                if (!w) return;

                if (b.writer != ws.data.id) return;

                broadcastWebsockets(b.readerSessions, { cmd: 3, content: b.content });
            }

            ws.send(JSON.stringify(res))
        },
        close(ws, code, reason) {
            if (ws.data.openedBoard) {
                const openedBoard = boards.get(ws.data.openedBoard);
                if (openedBoard) {
                    const i = openedBoard.readerSessions.indexOf(ws.data.remoteAddr);
                    if (i > -1)
                        delete openedBoard.readerSessions[i];
                }
            }

            if (ws.data.type == WebSocketType.Writer) {
                const w = writers.get(ws.data.id);
                if (w === undefined)
                    return;

                const i = w.sessions.indexOf(ws.data.remoteAddr);
                if (i > -1)
                    delete w.sessions[i];
            }

            websocketsClients.delete(ws.data.remoteAddr)
        },
    }
});