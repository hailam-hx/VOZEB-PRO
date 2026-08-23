import { describe, expect, it } from "vitest";

import { POSTGRESQL_TOP_UP_SCHEMA_SQL } from "./schema-top-ups";
import { POSTGRESQL_SCHEMA_SQL } from "./schema";

describe("top-up commerce schema", () => {
    it("keeps webhook identity on settled payments rather than fresh orders", () => {
        const orders = tableDefinition("top_up_orders");
        const payments = tableDefinition("top_up_payments");

        expect(orders).not.toContain("provider_event_id");
        expect(orders).not.toContain("order_snapshot_fingerprint");
        expect(payments).toContain("provider_event_id text NOT NULL");
        expect(payments).toContain("order_snapshot_fingerprint text NOT NULL");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS top_up_payments_provider_event_idx ON top_up_payments (provider, provider_event_id)");
    });

    it("stores exact authoritative snapshots and separate payment, grant, refund, and recovery states", () => {
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS top_up_presets");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("nominal_native_amount numeric(30, 12)");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("credit_amount numeric(30, 8)");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("customer_fx_rate numeric(30, 12)");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("payment_state text");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("credit_grant_state text");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("provider_refund_state text");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("credit_recovery_state text");
    });

    it("keeps fiat and crypto transaction identity distinct and crypto hashes unique", () => {
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("payment_kind text");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("amount_minor numeric(30, 0)");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("amount_atomic numeric(78, 0)");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("top_up_payments_crypto_transaction_idx");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("(crypto_asset, crypto_network, crypto_tx_hash)");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("status <> 'succeeded' OR crypto_tx_hash IS NOT NULL");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("crypto_tx_hash = lower(btrim(crypto_tx_hash))");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("amount_atomic >= 0");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("crypto_decimals BETWEEN 0 AND 30");
    });

    it("contains no retired billing record or amount-cents helper types", async () => {
        const [types, utils] = await Promise.all([
            import("node:fs/promises").then((fs) => fs.readFile(new URL("./repository-types.ts", import.meta.url), "utf8")),
            import("node:fs/promises").then((fs) => fs.readFile(new URL("./repository-utils.ts", import.meta.url), "utf8")),
        ]);
        for (const legacy of ["BillingProductRecord", "BillingOrderRecord", "PaymentTransactionRecord", "amountCents", "billingProductKindValue", "billingOrderStatusValue", "paymentTransactionStatusValue"]) {
            expect(`${types}\n${utils}`).not.toContain(legacy);
        }
    });

    it("persists separate unsigned local paid and refunded reconciliation totals", () => {
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("local_paid_amount jsonb NOT NULL");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("local_refunded_amount jsonb NOT NULL");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).not.toContain("local_matched_amount");
    });

    it("links exactly-once grants and full-refund recovery holds to the order", () => {
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("grant_point_record_id text REFERENCES point_records(id)");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("recovery_hold_id text REFERENCES wallet_holds(id)");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("reversal_point_record_id text REFERENCES point_records(id)");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("order_id text NOT NULL UNIQUE REFERENCES top_up_orders(id)");
    });

    it("persists top-up-only promotion and coupon rules without plan products", () => {
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS top_up_promotions");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS top_up_coupon_templates");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS top_up_user_coupons");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).not.toContain("product_kind");
        expect(POSTGRESQL_TOP_UP_SCHEMA_SQL).not.toContain("plan_id");
    });

    it("does not register the retired plan commerce domain", () => {
        for (const identifier of [
            "billing_products",
            "billing_orders",
            "payment_transactions",
            "billing_refund_jobs",
            "billing_reconciliation_runs",
            "billing_reconciliation_rows",
            "product_kind",
        ]) {
            expect(POSTGRESQL_SCHEMA_SQL).not.toContain(identifier);
        }
        expect(POSTGRESQL_SCHEMA_SQL).toContain("top_up_orders");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("top_up_reconciliation_runs");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("difference_direction text NOT NULL");
    });
});

function tableDefinition(table: string) {
    const start = POSTGRESQL_TOP_UP_SCHEMA_SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
    const end = POSTGRESQL_TOP_UP_SCHEMA_SQL.indexOf("\n);", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return POSTGRESQL_TOP_UP_SCHEMA_SQL.slice(start, end);
}
