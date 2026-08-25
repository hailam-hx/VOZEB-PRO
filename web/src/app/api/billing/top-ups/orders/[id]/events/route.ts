import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { subscribeTopUpOrderEvent } from "@/lib/server/top-up-order-event-signal";
import { isBillingInputError } from "@/lib/server/billing-errors";
import { getTopUpOrderForUser } from "@/lib/server/top-up-commerce-service";
import type { TopUpOrder } from "@/lib/server/top-up-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });

    const { id } = await context.params;
    let initialOrder: TopUpOrder;
    try {
        initialOrder = await getTopUpOrderForUser(currentUser.id, id);
    } catch (error) {
        if (isBillingInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Subscribe top-up order failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "获取订单失败" }, { status: 500 });
    }

    const encoder = new TextEncoder();
    let dispose: () => void = () => undefined;
    const body = new ReadableStream({
        start(controller) {
            let closed = false;
            let unsubscribe: (() => void) | undefined;
            let lastVersion = "";
            const close = () => {
                if (closed) return;
                closed = true;
                unsubscribe?.();
                request.signal.removeEventListener("abort", close);
                try {
                    controller.close();
                } catch {
                    // The client may already have cancelled the stream.
                }
            };
            const emit = (order: TopUpOrder) => {
                if (closed) return;
                const version = `${order.status}:${order.updatedAt}`;
                if (version !== lastVersion) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ code: 0, data: { order }, msg: "" })}\n\n`));
                    lastVersion = version;
                }
                if (order.status !== "pending") close();
            };
            const emitLatest = async () => {
                emit(await getTopUpOrderForUser(currentUser.id, id));
            };

            dispose = close;
            request.signal.addEventListener("abort", close, { once: true });
            emit(initialOrder);
            if (closed) return;

            void subscribeTopUpOrderEvent(id, () => void emitLatest().catch(close))
                .then(async (release) => {
                    if (closed) {
                        release();
                        return;
                    }
                    unsubscribe = release;
                    await emitLatest();
                })
                .catch(close);
        },
        cancel() {
            dispose();
        },
    });

    return new Response(body, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "private, no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
