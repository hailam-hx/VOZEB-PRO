export const POSTGRESQL_TOP_UP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS top_up_presets (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    nominal_native_amount numeric(30, 12) NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_presets_amount CHECK (nominal_native_amount > 0 AND nominal_native_amount = trunc(nominal_native_amount))
);

CREATE INDEX IF NOT EXISTS top_up_presets_enabled_idx ON top_up_presets (enabled, sort_order, id);

CREATE TABLE IF NOT EXISTS top_up_promotions (
    id text PRIMARY KEY,
    preset_id text REFERENCES top_up_presets(id) ON DELETE CASCADE,
    label text NOT NULL,
    discount_type text NOT NULL,
    discount_value numeric(30, 12) NOT NULL,
    currency text,
    enabled boolean NOT NULL DEFAULT true,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_promotions_type CHECK (discount_type IN ('fixed', 'percentage')),
    CONSTRAINT top_up_promotions_value CHECK (discount_value > 0),
    CONSTRAINT top_up_promotions_time CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS top_up_coupon_templates (
    id text PRIMARY KEY,
    name text NOT NULL,
    discount_type text NOT NULL,
    discount_value numeric(30, 12) NOT NULL,
    currency text,
    enabled boolean NOT NULL DEFAULT true,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_coupon_templates_type CHECK (discount_type IN ('fixed', 'percentage')),
    CONSTRAINT top_up_coupon_templates_value CHECK (discount_value > 0),
    CONSTRAINT top_up_coupon_templates_time CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS top_up_user_coupons (
    id text PRIMARY KEY,
    template_id text NOT NULL REFERENCES top_up_coupon_templates(id) ON DELETE RESTRICT,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'available',
    grant_source text NOT NULL DEFAULT 'claim',
    locked_order_id text,
    locked_at timestamptz,
    redeemed_order_id text,
    redeemed_at timestamptz,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_user_coupons_status CHECK (status IN ('available', 'locked', 'redeemed', 'revoked'))
);

CREATE INDEX IF NOT EXISTS top_up_promotions_active_idx ON top_up_promotions (enabled, starts_at, ends_at, preset_id);
CREATE INDEX IF NOT EXISTS top_up_user_coupons_user_idx ON top_up_user_coupons (user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS top_up_orders (
    id text PRIMARY KEY,
    order_no text NOT NULL UNIQUE,
    preset_id text REFERENCES top_up_presets(id) ON DELETE SET NULL,
    user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'pending',
    payment_state text NOT NULL DEFAULT 'pending',
    credit_grant_state text NOT NULL DEFAULT 'pending',
    provider_refund_state text NOT NULL DEFAULT 'none',
    credit_recovery_state text NOT NULL DEFAULT 'none',
    subject text NOT NULL,
    currency text NOT NULL,
    currency_exponent smallint NOT NULL,
    nominal_native_amount numeric(30, 12) NOT NULL,
    promotion_discount_native_amount numeric(30, 12) NOT NULL DEFAULT 0,
    coupon_discount_native_amount numeric(30, 12) NOT NULL DEFAULT 0,
    payable_native_amount numeric(30, 12) NOT NULL,
    nominal_usd_value numeric(30, 12) NOT NULL,
    paid_usd_value numeric(30, 12) NOT NULL,
    credit_amount numeric(30, 8) NOT NULL,
    pricing_version text NOT NULL,
    customer_fx_version text NOT NULL,
    customer_fx_rate numeric(30, 12) NOT NULL,
    payment_kind text NOT NULL,
    payment_amount jsonb NOT NULL,
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    order_snapshot_fingerprint text NOT NULL,
    provider_order_id text,
    provider_payment_id text,
    promotion_campaign_id text,
    user_coupon_id text REFERENCES top_up_user_coupons(id) ON DELETE SET NULL,
    grant_point_record_id text REFERENCES point_records(id),
    recovery_hold_id text REFERENCES wallet_holds(id),
    reversal_point_record_id text REFERENCES point_records(id),
    snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    expires_at timestamptz,
    paid_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_orders_status CHECK (status IN ('pending', 'paid', 'canceled', 'refunding', 'refunded')),
    CONSTRAINT top_up_orders_payment_state CHECK (payment_state IN ('pending', 'paid', 'failed', 'refunded')),
    CONSTRAINT top_up_orders_grant_state CHECK (credit_grant_state IN ('pending', 'granted', 'manual_review')),
    CONSTRAINT top_up_orders_provider_refund_state CHECK (provider_refund_state IN ('none', 'pending', 'succeeded', 'failed', 'manual')),
    CONSTRAINT top_up_orders_recovery_state CHECK (credit_recovery_state IN ('none', 'held', 'recovered', 'released', 'manual_review')),
    CONSTRAINT top_up_orders_v1_fiat CHECK (payment_kind = 'fiat' AND currency = 'VND' AND currency_exponent = 0),
    CONSTRAINT top_up_orders_amounts CHECK (nominal_native_amount > 0 AND nominal_native_amount = trunc(nominal_native_amount) AND promotion_discount_native_amount >= 0 AND coupon_discount_native_amount >= 0 AND payable_native_amount > 0 AND payable_native_amount = trunc(payable_native_amount) AND nominal_usd_value > 0 AND paid_usd_value > 0 AND credit_amount > 0)
);

CREATE INDEX IF NOT EXISTS top_up_orders_user_created_idx ON top_up_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS top_up_orders_status_created_idx ON top_up_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS top_up_orders_provider_payment_idx ON top_up_orders (provider, provider_payment_id);

CREATE TABLE IF NOT EXISTS top_up_payments (
    id text PRIMARY KEY,
    order_id text NOT NULL REFERENCES top_up_orders(id) ON DELETE RESTRICT,
    user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    status text NOT NULL,
    payment_kind text NOT NULL,
    fiat_currency text,
    amount_minor numeric(30, 0),
    minor_unit_exponent smallint,
    crypto_asset text,
    crypto_network text,
    amount_atomic numeric(78, 0),
    crypto_decimals smallint,
    crypto_tx_hash text,
    provider_trade_id text,
    provider_payment_id text,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    paid_at timestamptz,
    refunded_at timestamptz,
    failed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_payments_status CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
    CONSTRAINT top_up_payments_kind CHECK (payment_kind IN ('fiat', 'crypto')),
    CONSTRAINT top_up_payments_amount CHECK ((payment_kind = 'fiat' AND fiat_currency IS NOT NULL AND amount_minor IS NOT NULL AND amount_minor >= 0 AND minor_unit_exponent IS NOT NULL AND crypto_asset IS NULL AND crypto_network IS NULL AND amount_atomic IS NULL AND crypto_decimals IS NULL AND crypto_tx_hash IS NULL) OR (payment_kind = 'crypto' AND fiat_currency IS NULL AND amount_minor IS NULL AND minor_unit_exponent IS NULL AND crypto_asset IS NOT NULL AND crypto_network IS NOT NULL AND amount_atomic IS NOT NULL AND amount_atomic >= 0 AND crypto_decimals BETWEEN 0 AND 30)),
    CONSTRAINT top_up_payments_crypto_hash_required CHECK (payment_kind <> 'crypto' OR status <> 'succeeded' OR crypto_tx_hash IS NOT NULL),
    CONSTRAINT top_up_payments_crypto_hash_normalized CHECK (crypto_tx_hash IS NULL OR (crypto_tx_hash <> '' AND crypto_tx_hash = lower(btrim(crypto_tx_hash))))
);

CREATE INDEX IF NOT EXISTS top_up_payments_order_idx ON top_up_payments (order_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS top_up_payments_provider_trade_idx ON top_up_payments (provider, provider_trade_id) WHERE provider_trade_id IS NOT NULL AND provider_trade_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS top_up_payments_provider_payment_idx ON top_up_payments (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL AND provider_payment_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS top_up_payments_crypto_transaction_idx ON top_up_payments (crypto_asset, crypto_network, crypto_tx_hash) WHERE payment_kind = 'crypto' AND crypto_tx_hash IS NOT NULL AND crypto_tx_hash <> '';

CREATE TABLE IF NOT EXISTS top_up_payment_events (
    id text PRIMARY KEY,
    provider text NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    order_id text REFERENCES top_up_orders(id) ON DELETE SET NULL,
    payload_fingerprint text NOT NULL,
    signature_valid boolean NOT NULL,
    status text NOT NULL DEFAULT 'received',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    processed_at timestamptz,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_payment_events_status CHECK (status IN ('received', 'processing', 'processed', 'conflict', 'rejected')),
    UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS top_up_refunds (
    id text PRIMARY KEY,
    order_id text NOT NULL UNIQUE REFERENCES top_up_orders(id) ON DELETE RESTRICT,
    payment_id text REFERENCES top_up_payments(id) ON DELETE SET NULL,
    provider text NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    recovery_hold_id text REFERENCES wallet_holds(id),
    provider_refund_id text,
    request_fingerprint text NOT NULL,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason text NOT NULL,
    operator_user_id text REFERENCES users(id) ON DELETE SET NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_refunds_kind CHECK (kind IN ('full', 'partial', 'chargeback')),
    CONSTRAINT top_up_refunds_status CHECK (status IN ('holding', 'provider_pending', 'completed', 'released', 'manual_review', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS top_up_refunds_provider_refund_idx ON top_up_refunds (provider, provider_refund_id) WHERE provider_refund_id IS NOT NULL AND provider_refund_id <> '';

CREATE TABLE IF NOT EXISTS top_up_reconciliation_runs (
    id text PRIMARY KEY,
    provider text NOT NULL,
    source text NOT NULL DEFAULT 'csv',
    status text NOT NULL DEFAULT 'completed',
    total_rows integer NOT NULL DEFAULT 0,
    matched_rows integer NOT NULL DEFAULT 0,
    ok_rows integer NOT NULL DEFAULT 0,
    issue_rows integer NOT NULL DEFAULT 0,
    statement_paid_amount jsonb NOT NULL,
    statement_refunded_amount jsonb NOT NULL,
    local_paid_amount jsonb NOT NULL,
    local_refunded_amount jsonb NOT NULL,
    difference_amount jsonb NOT NULL,
    difference_direction text NOT NULL,
    local_nominal_usd_value numeric(30, 12) NOT NULL DEFAULT 0,
    local_paid_usd_value numeric(30, 12) NOT NULL DEFAULT 0,
    imported_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
    imported_by_username text,
    file_name text,
    file_hash text,
    note text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_reconciliation_runs_status CHECK (status IN ('completed', 'failed')),
    CONSTRAINT top_up_reconciliation_runs_source CHECK (source IN ('csv', 'provider-api', 'manual')),
    CONSTRAINT top_up_reconciliation_runs_difference CHECK (difference_direction IN ('statement_over', 'local_over', 'balanced'))
);

CREATE INDEX IF NOT EXISTS top_up_reconciliation_runs_created_idx ON top_up_reconciliation_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS top_up_reconciliation_runs_provider_created_idx ON top_up_reconciliation_runs (provider, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS top_up_reconciliation_runs_provider_file_hash_idx ON top_up_reconciliation_runs (provider, file_hash) WHERE file_hash IS NOT NULL AND file_hash <> '';

CREATE TABLE IF NOT EXISTS top_up_reconciliation_rows (
    id text PRIMARY KEY,
    run_id text NOT NULL REFERENCES top_up_reconciliation_runs(id) ON DELETE CASCADE,
    row_number integer NOT NULL,
    row_key text NOT NULL,
    provider text NOT NULL,
    order_no text,
    provider_order_id text,
    provider_payment_id text,
    statement_status text NOT NULL DEFAULT 'unknown',
    statement_payment_amount jsonb,
    local_order_id text REFERENCES top_up_orders(id) ON DELETE SET NULL,
    local_order_no text,
    local_order_status text,
    local_payment_amount jsonb,
    local_nominal_native_amount numeric(30, 12),
    local_payable_native_amount numeric(30, 12),
    local_nominal_usd_value numeric(30, 12),
    local_paid_usd_value numeric(30, 12),
    issue_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    issues jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT top_up_reconciliation_rows_statement_status CHECK (statement_status IN ('paid', 'refunded', 'pending', 'failed', 'unknown'))
);

CREATE INDEX IF NOT EXISTS top_up_reconciliation_rows_run_idx ON top_up_reconciliation_rows (run_id, row_number ASC);
CREATE INDEX IF NOT EXISTS top_up_reconciliation_rows_issue_codes_gin_idx ON top_up_reconciliation_rows USING gin (issue_codes);
`;
