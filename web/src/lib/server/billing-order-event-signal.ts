import { subscribePostgresNotification } from "@/lib/server/database";
import { TOP_UP_ORDER_NOTIFY_CHANNEL } from "@/lib/server/database/top-up-repository";

export async function subscribeBillingOrderEvent(orderId: string, listener: () => void) {
    const targetOrderId = orderId.trim();
    if (!targetOrderId) throw new Error("Billing order ID is required");
    return subscribePostgresNotification(TOP_UP_ORDER_NOTIFY_CHANNEL, (payload) => {
        if (payload.trim() === targetOrderId) listener();
    });
}
