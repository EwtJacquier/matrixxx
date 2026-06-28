// Servidor custom: Next.js + Socket.IO no mesmo processo.

import { createServer } from "http";
import next from "next";
import { Server as IOServer } from "socket.io";
import { initStore } from "./src/server/data/store";
import { registerSocket } from "./src/server/socket";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "0.0.0.0";
const port = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  await initStore();

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => handle(req, res));

  const io = new IOServer(server, {
    cors: { origin: true, credentials: true },
    // Uploads de MP3 (data URL) e imagens chegam via socket; o padrão de 1 MB
    // é pequeno demais e derrubaria a conexão. Eleva para 30 MB.
    maxHttpBufferSize: 30 * 1024 * 1024,
  });
  registerSocket(io);

  server.listen(port, hostname, () => {
    // eslint-disable-next-line no-console
    console.log(`> Matrix RPG pronto em http://${hostname}:${port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
