import { NextResponse } from "next/server";

import { BillingInputError, isBillingInputError } from "@/lib/server/billing-errors";
import { normalizePaymentProvider } from "@/lib/payment-provider";
import { processTopUpWebhook } from "@/lib/server/top-up-webhook-service";
import { readRequestBodyText, RequestBodyTooLargeError } from "@/lib/server/request-body-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ provider: string }>;
};
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export async function POST(request: Request, context: RouteContext) {
    const { provider } = await context.params;
    const isZaloPay = normalizePaymentProvider(provider) === "zalopay";
    try {
        const result = await processTopUpWebhook({
            provider,
            rawBody: await readRequestBodyText(request, MAX_WEBHOOK_BODY_BYTES),
            headers: request.headers,
        });
        if (isZaloPay) return zalopayAck(1, "success");
        return NextResponse.json({ code: 0, data: result, msg: "" });
    } catch (error) {
        if (isZaloPay) {
            if (error instanceof RequestBodyTooLargeError || (isBillingInputError(error) && error.status < 500)) return zalopayAck(2, "invalid");
            console.error("ZaloPay webhook failed", error);
            return zalopayAck(0, "retry");
        }
        if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        if (isBillingInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        if (error instanceof BillingInputError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Payment webhook failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "支付回调处理失败" }, { status: 500 });
    }
}

function zalopayAck(returnCode: 0 | 1 | 2, returnMessage: "retry" | "success" | "invalid") {
    return NextResponse.json({ return_code: returnCode, return_message: returnMessage });
}
