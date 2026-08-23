import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getTopUpOrderForUser } from "@/lib/server/top-up-commerce-service";
import { commerceError, commerceOk } from "../../commerce-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });

    try {
        const { id } = await context.params;
        return commerceOk({ order: await getTopUpOrderForUser(currentUser.id, id) });
    } catch (error) {
        return commerceError(error, "获取充值订单失败", "Get top-up order failed");
    }
}
