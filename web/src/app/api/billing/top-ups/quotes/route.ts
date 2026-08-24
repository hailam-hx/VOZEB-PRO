import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { quoteTopUpOrder } from "@/lib/server/top-up-commerce-service";
import { commerceError, commerceOk } from "../../commerce-response";
import { assertTopUpRequestContract } from "../request-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const body = assertTopUpRequestContract(await readJsonBody<Record<string, unknown>>(request), "quote");
        return commerceOk({ quote: (await quoteTopUpOrder({ ...body, userId: user.id })).quote });
    } catch (error) {
        return commerceError(error, "获取结算价格失败", "Quote top-up order failed");
    }
}
