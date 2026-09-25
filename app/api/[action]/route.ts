import { env } from "cloudflare:workers";

type Move = "cooperate" | "defect";
type Round = { round: number; moves: [Move, Move]; coins: [number, number]; totals: [number, number] };
type Room = {
  code: string;
  gameId?: string;
  tokens: [string, string | null];
  emojis: string[];
  emojiSelected: string | null;
  moves: [Move | null, Move | null];
  totals: [number, number];
  history: Round[];
  round: number;
  maxRounds: number;
  revealed: boolean;
  quitBy?: number;
};
type Row = { code: string; state: string; revision: number };
type Context = { params: Promise<{ action: string }> };
type Input = Record<string, unknown>;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};
const result = (value: unknown, status = 200) => Response.json(value, { status, headers: cors });
const failure = (error: string, status: number) => result({ error }, status);
const db = () => {
  if (!env.DB) throw new Error("Room database unavailable");
  return env.DB;
};
const token = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
const randomCode = () => String(100 + crypto.getRandomValues(new Uint32Array(1))[0] % 900);
const emojiPool = ['🐙','🦊','🦄','🐸','🦖','🐧','🍕','🍉','🍩','🥑','🌈','🌻','🍄','🚀','🛸','🎈','🎩','🎸','🎲','🧩','💎','🦋','🐢','🦝','🐝','🍋','🥨','🧁','⚡','🌙','⭐','🔥','❄️','🌵','🪁','🛼','🪄','👑','🧸','🪩'];
const emojis = () => emojiPool.map(emoji => ({ emoji, key: crypto.getRandomValues(new Uint32Array(1))[0] })).sort((a,b) => a.key - b.key).slice(0,5).map(item => item.emoji);
const coinsFor = (first: Move, second: Move): [number, number] => first === "cooperate" && second === "cooperate" ? [3,3] : first === "defect" && second === "defect" ? [-3,-3] : first === "defect" ? [6,-6] : [-6,6];
const codeOf = (input: Input) => String(input.code ?? "").trim();
const getRoom = async (code: string) => {
  const row = await db().prepare("SELECT code, state, revision FROM rooms WHERE code = ?").bind(code).first<Row>();
  return row ? { room: JSON.parse(row.state) as Room, revision: row.revision } : null;
};
const gameIdOf = (room: Room) => room.gameId ?? room.code;
const isFinished = (room: Room) => room.history.length === room.maxRounds && room.quitBy === undefined;
const archiveCompleted = async (room: Room) => {
  if (!isFinished(room)) return;
  await db().prepare("INSERT OR IGNORE INTO completed_games (game_id, combined_coins, finished_at) VALUES (?, ?, ?)")
    .bind(gameIdOf(room), room.totals[0] + room.totals[1], Date.now()).run();
};
const dailyComparison = async (room: Room) => {
  if (!isFinished(room)) return null;
  const completed = await db().prepare("SELECT finished_at AS finishedAt FROM completed_games WHERE game_id = ?")
    .bind(gameIdOf(room)).first<{ finishedAt: number }>();
  if (!completed) return null;
  const row = await db().prepare("SELECT COUNT(*) AS count, AVG(combined_coins) AS average FROM completed_games WHERE finished_at >= ? AND finished_at <= ? AND game_id <> ?")
    .bind(completed.finishedAt - 24 * 60 * 60 * 1000, completed.finishedAt, gameIdOf(room)).first<{ count: number; average: number | null }>();
  return row?.count && row.average !== null ? { count: row.count, average: Math.round(row.average) } : null;
};
const view = async (room: Room, revision: number, side: number) => ({
  code: room.code, revision, side, round: room.round, maxRounds: room.maxRounds,
  emojis: room.emojis, emojiSelected: side === 0 ? room.emojiSelected : undefined,
  joined: !!room.tokens[1], submitted: !!room.moves[side], opponentSubmitted: !!room.moves[1 - side],
  totals: room.totals, history: room.history, quitBy: room.quitBy ?? null,
  daily: await dailyComparison(room),
  phase: room.quitBy !== undefined ? "quit" : room.history.length === room.maxRounds ? "finished" : room.revealed ? "revealed" : "choosing",
});

type Mutation = { error: string; status: number } | { session?: { code: string; token: string; side: number }; error?: never; status?: never };
const isFailure = (value: Mutation): value is { error: string; status: number } => typeof value.error === "string";
async function mutate(code: string, apply: (room: Room) => Mutation) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await getRoom(code);
    if (!current) return { error: "Room not found", status: 404 } as const;
    const outcome = apply(current.room);
    if (isFailure(outcome)) return outcome;
    const saved = await db().prepare("UPDATE rooms SET state = ?, revision = revision + 1 WHERE code = ? AND revision = ?")
      .bind(JSON.stringify(current.room), code, current.revision).run();
    if (saved.meta.changes) return { room: current.room, revision: current.revision + 1, ...outcome };
  }
  return { error: "That changed at the same time. Please try again.", status: 409 } as const;
}
const authenticated = async (input: Input) => {
  const current = await getRoom(codeOf(input));
  const side = current?.room.tokens.indexOf(String(input.token ?? "")) ?? -1;
  return current && side >= 0 ? { ...current, side } : null;
};

export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

export async function GET(request: Request, context: Context) {
  try {
    const { action } = await context.params;
    if (action !== "state") return failure("Not found", 404);
    const input = Object.fromEntries(new URL(request.url).searchParams);
    const current = await authenticated(input);
    if (current) await archiveCompleted(current.room);
    return current ? result(await view(current.room, current.revision, current.side)) : failure("Room access expired", 401);
  } catch { return failure("Room service unavailable", 503); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { action } = await context.params;
    const input = await request.json() as Input;
    if (action === "create") {
      await db().prepare("DELETE FROM rooms WHERE created_at < ?").bind(Date.now() - 4 * 60 * 60 * 1000).run();
      await db().prepare("DELETE FROM completed_games WHERE finished_at < ?").bind(Date.now() - 30 * 24 * 60 * 60 * 1000).run();
      for (let attempt = 0; attempt < 50; attempt++) {
        const code = randomCode();
        const room: Room = { code, gameId: crypto.randomUUID(), tokens: [token(), null], emojis: emojis(), emojiSelected: null, moves: [null,null], totals: [0,0], history: [], round: 1, maxRounds: 10, revealed: false };
        const saved = await db().prepare("INSERT OR IGNORE INTO rooms (code, state, revision, created_at) VALUES (?, ?, 0, ?)").bind(code, JSON.stringify(room), Date.now()).run();
        if (saved.meta.changes) return result({ code, token: room.tokens[0], side: 0 });
      }
      return failure("All room numbers are busy. Try again later.", 503);
    }
    const code = codeOf(input);
    if (action === "join") {
      const current = await getRoom(code);
      if (!current) return failure("Room not found", 404);
      if (current.room.tokens[1]) return failure("This room already has two teams", 409);
      return result({ code, emojis: current.room.emojis, waiting: !current.room.emojiSelected });
    }
    if (action === "confirm") {
      const changed = await mutate(code, room => {
        if (!room.emojiSelected) return { error: "Room not ready", status: 404 };
        if (room.tokens[1]) return { error: "This room already has two teams", status: 409 };
        if (input.emoji !== room.emojiSelected) return { error: "Not the matching emoji. Ask the other team!", status: 403 };
        room.tokens[1] = token();
        return { session: { code, token: room.tokens[1], side: 1 } };
      });
      return isFailure(changed) ? failure(changed.error, changed.status) : result(changed.session);
    }
    const auth = await authenticated(input);
    if (!auth) return failure("Room access expired", 401);
    if (action === "restart") await archiveCompleted(auth.room);
    const changed = await mutate(code, room => {
      const side = room.tokens.indexOf(String(input.token));
      if (side < 0) return { error: "Room access expired", status: 401 };
      if (action === "select-emoji") {
        if (side !== 0 || room.emojiSelected || room.tokens[1]) return { error: "Emoji already chosen", status: 409 };
        if (!room.emojis.includes(String(input.emoji))) return { error: "Choose one of the five emojis", status: 400 };
        room.emojiSelected = String(input.emoji);
      } else if (action === "choose") {
        if (!room.tokens[1] || room.revealed || room.quitBy !== undefined || room.history.length === room.maxRounds) return { error: "Not accepting choices now", status: 409 };
        if (input.move !== "cooperate" && input.move !== "defect") return { error: "Choose Cooperate or Defect", status: 400 };
        if (room.moves[side]) return { error: "Choice already locked", status: 409 };
        room.moves[side] = input.move;
        if (room.moves[0] && room.moves[1]) {
          const factor = room.round >= 9 ? 2 : 1;
          const coins = coinsFor(room.moves[0], room.moves[1]).map(n => n * factor) as [number, number];
          room.totals = room.totals.map((n,i) => n + coins[i]) as [number, number];
          room.history.push({ round: room.round, moves: [room.moves[0], room.moves[1]], coins, totals: [...room.totals] });
          room.revealed = true;
        }
      } else if (action === "next") {
        if (!room.revealed || room.quitBy !== undefined || room.history.length === room.maxRounds) return { error: "Round is not ready", status: 409 };
        room.round++;
        room.moves = [null,null];
        room.revealed = false;
      } else if (action === "quit") {
        if (!room.revealed || room.quitBy !== undefined || room.history.length === room.maxRounds) return { error: "The game cannot be ended now", status: 409 };
        room.quitBy = side;
      } else if (action === "restart") {
        const ended = room.quitBy !== undefined || room.history.length === room.maxRounds;
        if (!ended) return { error: "Finish this game before starting another", status: 409 };
        room.gameId = crypto.randomUUID(); room.round = 1; room.moves = [null,null]; room.totals = [0,0]; room.history = []; room.revealed = false; delete room.quitBy;
      } else return { error: "Not found", status: 404 };
      return {};
    });
    if (isFailure(changed)) {
      if (action === "restart" && changed.error === "Finish this game before starting another") {
        const current = await authenticated(input);
        if (current && current.room.round === 1 && current.room.history.length === 0 && !current.room.moves[0] && !current.room.moves[1]) return result(await view(current.room, current.revision, current.side));
      }
      return failure(changed.error, changed.status);
    }
    await archiveCompleted(changed.room);
    return result(await view(changed.room, changed.revision, auth.side));
  } catch { return failure("Room service unavailable", 503); }
}
