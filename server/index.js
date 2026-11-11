// Web server: serves the site, creates rooms, and relays live moves with Socket.IO.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Rooms } from './rooms.js';
import { warmUp } from './boss.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Rooms(io);

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(root, 'public')));

// Third-party files the browser needs, served straight from node_modules.
app.get('/vendor/chess.js', (req, res) => res.sendFile(path.join(root, 'node_modules/chess.js/dist/esm/chess.js')));
const SF_FILES = new Set(['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']);
app.get('/vendor/stockfish/:file', (req, res) => {
  if (!SF_FILES.has(req.params.file)) return res.sendStatus(404);
  if (req.params.file.endsWith('.wasm')) res.type('application/wasm');
  res.set('Cache-Control', 'public, max-age=604800');
  res.sendFile(path.join(root, 'node_modules/stockfish/bin', req.params.file));
});

app.post('/api/rooms', (req, res) => {
  try {
    const room = rooms.create(req.body || {});
    res.json({ code: room.code });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

io.on('connection', (socket) => rooms.attach(socket));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess Co-op running at http://localhost:${PORT}`);
  warmUp();
});
