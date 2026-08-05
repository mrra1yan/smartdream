import { cookies } from "next/headers";
import { getSessionFromCookie } from "@/lib/session-cookie";
import { redisSub } from "@/lib/redis";

/**
 * SSE endpoint (replaces Supabase Realtime).
 *
 * The browser opens one EventSource per tab; the server subscribes a
 * DEDICATED Redis client (duplicate of the shared subscription client) to
 * the user's channels:
 *   chan:stats:{userId}  — a like just landed on the receiver's page
 *   chan:links:{userId}  — one of the user's links gained a like
 * Server actions PUBLISH to these channels (src/lib/realtime-publish.ts).
 *
 * Node runtime only (Redis sockets); must not run on the Edge. nginx in
 * front must disable proxy_buffering for this path (see plan §6).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const store = await cookies();
  const session = await getSessionFromCookie(store.getAll());
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const channels = [`chan:stats:${session.sub}`, `chan:links:${session.sub}`];
  const client = redisSub.duplicate();
  // Per-connection client needs its own error listener (ioredis throws on
  // unhandled 'error' events; duplicate() does not inherit listeners).
  client.on("error", (err) =>
    console.error("[realtime] connection error:", (err as Error).message),
  );

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    client.unsubscribe(...channels).catch(() => {});
    client.disconnect();
  };

  const stream = new ReadableStream({
    async start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      try {
        await client.subscribe(...channels);
      } catch (err) {
        console.error("[realtime] subscribe failed:", (err as Error).message);
        controller.error(err);
        close();
        return;
      }

      client.on("message", (channel, message) => {
        if (channels.includes(channel)) {
          try {
            controller.enqueue(`data: ${message}\n\n`);
          } catch {
            close();
          }
        }
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(": ping\n\n");
        } catch {
          close();
        }
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        if (heartbeat) clearInterval(heartbeat);
        close();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
