export const POSTGRESQL_COMMERCIAL_FEATURES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS referral_programs (
    id text PRIMARY KEY DEFAULT 'default',
    enabled boolean NOT NULL DEFAULT false,
    inviter_points numeric(30, 8) NOT NULL DEFAULT 0,
    invitee_reward_type text NOT NULL DEFAULT 'points',
    invitee_points numeric(30, 8) NOT NULL DEFAULT 0,
    invitee_top_up_coupon_template_id text REFERENCES top_up_coupon_templates(id) ON DELETE SET NULL,
    minimum_paid_usd numeric(30, 12) NOT NULL DEFAULT 0,
    cooling_off_days integer NOT NULL DEFAULT 7,
    inviter_monthly_limit integer NOT NULL DEFAULT 0,
    campaign_total_limit integer NOT NULL DEFAULT 0,
    auto_freeze_risk boolean NOT NULL DEFAULT true,
    created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT referral_programs_singleton CHECK (id = 'default'),
    CONSTRAINT referral_programs_reward_type CHECK (invitee_reward_type IN ('points', 'coupon')),
    CONSTRAINT referral_programs_values CHECK (inviter_points >= 0 AND invitee_points >= 0 AND minimum_paid_usd >= 0 AND cooling_off_days >= 0 AND inviter_monthly_limit >= 0 AND campaign_total_limit >= 0),
    CONSTRAINT referral_programs_coupon CHECK (invitee_reward_type <> 'coupon' OR invitee_top_up_coupon_template_id IS NOT NULL)
);

INSERT INTO referral_programs (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS referral_codes (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    code text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    click_count bigint NOT NULL DEFAULT 0,
    last_clicked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT referral_codes_clicks CHECK (click_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (upper(code));

CREATE TABLE IF NOT EXISTS referral_relationships (
    id text PRIMARY KEY,
    inviter_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    invitee_user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    referral_code_id text NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
    attribution_source text NOT NULL DEFAULT 'registration-form',
    attribution_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    registration_ip_hash text,
    payment_identity_hash text,
    risk_status text NOT NULL DEFAULT 'clear',
    risk_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
    registered_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT referral_relationships_users CHECK (inviter_user_id <> invitee_user_id),
    CONSTRAINT referral_relationships_risk CHECK (risk_status IN ('clear', 'review', 'frozen', 'rejected'))
);

CREATE INDEX IF NOT EXISTS referral_relationships_inviter_idx ON referral_relationships (inviter_user_id, registered_at DESC);
CREATE INDEX IF NOT EXISTS referral_relationships_risk_idx ON referral_relationships (risk_status, registered_at DESC);
CREATE INDEX IF NOT EXISTS referral_relationships_ip_idx ON referral_relationships (inviter_user_id, registration_ip_hash, registered_at DESC) WHERE registration_ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS referral_relationships_payment_idx ON referral_relationships (payment_identity_hash) WHERE payment_identity_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS referral_rewards (
    id text PRIMARY KEY,
    relationship_id text NOT NULL REFERENCES referral_relationships(id) ON DELETE RESTRICT,
    beneficiary_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    beneficiary_role text NOT NULL,
    reward_type text NOT NULL,
    points_amount numeric(30, 8) NOT NULL DEFAULT 0,
    top_up_coupon_template_id text REFERENCES top_up_coupon_templates(id) ON DELETE SET NULL,
    trigger_order_id text NOT NULL REFERENCES top_up_orders(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'pending',
    settle_after timestamptz NOT NULL,
    wallet_record_id text REFERENCES point_records(id) ON DELETE SET NULL,
    reversal_wallet_record_id text REFERENCES point_records(id) ON DELETE SET NULL,
    top_up_user_coupon_id text REFERENCES top_up_user_coupons(id) ON DELETE SET NULL,
    reason text,
    settled_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT referral_rewards_role CHECK (beneficiary_role IN ('inviter', 'invitee')),
    CONSTRAINT referral_rewards_type CHECK (reward_type IN ('points', 'coupon')),
    CONSTRAINT referral_rewards_status CHECK (status IN ('pending', 'settled', 'revoked', 'rejected', 'reversal_pending', 'manual_review')),
    CONSTRAINT referral_rewards_values CHECK (points_amount >= 0 AND (reward_type <> 'coupon' OR top_up_coupon_template_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_rewards_relationship_role_idx ON referral_rewards (relationship_id, beneficiary_role);
CREATE INDEX IF NOT EXISTS referral_rewards_trigger_order_idx ON referral_rewards (trigger_order_id, beneficiary_role);
CREATE INDEX IF NOT EXISTS referral_rewards_beneficiary_idx ON referral_rewards (beneficiary_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referral_rewards_due_idx ON referral_rewards (settle_after, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS referral_rewards_status_idx ON referral_rewards (status, created_at DESC);

CREATE TABLE IF NOT EXISTS published_works (
    id text PRIMARY KEY,
    owner_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    slug text NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    lifecycle_status text NOT NULL DEFAULT 'active',
    current_version_id text,
    published_version_id text,
    is_featured boolean NOT NULL DEFAULT false,
    featured_at timestamptz,
    featured_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
    view_count bigint NOT NULL DEFAULT 0,
    like_count bigint NOT NULL DEFAULT 0,
    last_viewed_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT published_works_source_type CHECK (source_type IN ('media', 'canvas', 'drama')),
    CONSTRAINT published_works_lifecycle CHECK (lifecycle_status IN ('active', 'revoked')),
    CONSTRAINT published_works_views CHECK (view_count >= 0),
    CONSTRAINT published_works_community_counts CHECK (like_count >= 0)
);

ALTER TABLE published_works ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
ALTER TABLE published_works ADD COLUMN IF NOT EXISTS featured_at timestamptz;
ALTER TABLE published_works ADD COLUMN IF NOT EXISTS featured_by_user_id text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE published_works ADD COLUMN IF NOT EXISTS like_count bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'published_works_community_counts') THEN
        ALTER TABLE published_works ADD CONSTRAINT published_works_community_counts CHECK (like_count >= 0);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS published_works_slug_idx ON published_works (lower(slug));
CREATE INDEX IF NOT EXISTS published_works_owner_updated_idx ON published_works (owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS published_works_lifecycle_idx ON published_works (lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS published_works_gallery_featured_idx ON published_works (is_featured DESC, featured_at DESC, id DESC) WHERE lifecycle_status = 'active' AND published_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS published_works_gallery_popular_idx ON published_works (view_count DESC, id DESC) WHERE lifecycle_status = 'active' AND published_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS published_work_versions (
    id text PRIMARY KEY,
    work_id text NOT NULL REFERENCES published_works(id) ON DELETE RESTRICT,
    version_number integer NOT NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    public_prompt text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT '',
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    visibility text NOT NULL DEFAULT 'private',
    author_display text NOT NULL DEFAULT 'profile',
    author_name text,
    moderation_status text NOT NULL DEFAULT 'draft',
    rejection_reason text,
    submitted_at timestamptz,
    reviewed_at timestamptz,
    reviewed_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
    moderation_provider text,
    moderation_signal jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT published_work_versions_number CHECK (version_number > 0),
    CONSTRAINT published_work_versions_visibility CHECK (visibility IN ('private', 'unlisted', 'public')),
    CONSTRAINT published_work_versions_author CHECK (author_display IN ('profile', 'custom', 'hidden')),
    CONSTRAINT published_work_versions_moderation CHECK (moderation_status IN ('draft', 'pending', 'approved', 'rejected', 'taken_down'))
);

CREATE UNIQUE INDEX IF NOT EXISTS published_work_versions_work_number_idx ON published_work_versions (work_id, version_number);
CREATE INDEX IF NOT EXISTS published_work_versions_moderation_idx ON published_work_versions (moderation_status, submitted_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS published_work_versions_public_idx ON published_work_versions (visibility, reviewed_at DESC) WHERE moderation_status = 'approved';
CREATE INDEX IF NOT EXISTS published_work_versions_public_category_idx ON published_work_versions (category, reviewed_at DESC, id DESC) WHERE moderation_status = 'approved' AND visibility = 'public';
CREATE INDEX IF NOT EXISTS published_work_versions_public_tags_idx ON published_work_versions USING gin (tags) WHERE moderation_status = 'approved' AND visibility = 'public';
CREATE INDEX IF NOT EXISTS published_work_versions_public_search_idx ON published_work_versions USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, ''))) WHERE moderation_status = 'approved' AND visibility = 'public';

CREATE TABLE IF NOT EXISTS published_work_assets (
    id text PRIMARY KEY,
    version_id text NOT NULL REFERENCES published_work_versions(id) ON DELETE RESTRICT,
    storage_key text NOT NULL REFERENCES local_media_assets(storage_key) ON DELETE RESTRICT,
    media_type text NOT NULL,
    mime_type text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'content',
    sort_order integer NOT NULL DEFAULT 0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT published_work_assets_type CHECK (media_type IN ('image', 'video', 'audio')),
    CONSTRAINT published_work_assets_role CHECK (role IN ('cover', 'content')),
    CONSTRAINT published_work_assets_order CHECK (sort_order >= 0),
    CONSTRAINT published_work_assets_unique_role UNIQUE (version_id, storage_key, role)
);

CREATE INDEX IF NOT EXISTS published_work_assets_version_order_idx ON published_work_assets (version_id, role, sort_order, id);
CREATE INDEX IF NOT EXISTS published_work_assets_storage_idx ON published_work_assets (storage_key);

ALTER TABLE published_work_versions ADD COLUMN IF NOT EXISTS moderation_provider text;
ALTER TABLE published_work_versions ADD COLUMN IF NOT EXISTS moderation_signal jsonb;
ALTER TABLE published_work_versions ADD COLUMN IF NOT EXISTS public_prompt text NOT NULL DEFAULT '';

ALTER TABLE published_works DROP CONSTRAINT IF EXISTS published_works_current_version_fk;
ALTER TABLE published_works ADD CONSTRAINT published_works_current_version_fk FOREIGN KEY (current_version_id) REFERENCES published_work_versions(id) ON DELETE RESTRICT;
ALTER TABLE published_works DROP CONSTRAINT IF EXISTS published_works_published_version_fk;
ALTER TABLE published_works ADD CONSTRAINT published_works_published_version_fk FOREIGN KEY (published_version_id) REFERENCES published_work_versions(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS published_work_cases (
    id text PRIMARY KEY,
    work_id text NOT NULL REFERENCES published_works(id) ON DELETE RESTRICT,
    version_id text NOT NULL REFERENCES published_work_versions(id) ON DELETE RESTRICT,
    submitter_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    case_type text NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    resolution text,
    handled_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
    handled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT published_work_cases_type CHECK (case_type IN ('report', 'appeal')),
    CONSTRAINT published_work_cases_status CHECK (status IN ('open', 'approved', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS published_work_cases_open_unique_idx ON published_work_cases (version_id, submitter_user_id, case_type) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS published_work_cases_admin_idx ON published_work_cases (status, case_type, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS published_work_cases_work_idx ON published_work_cases (work_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS published_work_likes (
    work_id text NOT NULL REFERENCES published_works(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_id, user_id)
);

CREATE INDEX IF NOT EXISTS published_work_likes_user_created_idx ON published_work_likes (user_id, created_at DESC, work_id);
CREATE INDEX IF NOT EXISTS published_work_likes_work_created_idx ON published_work_likes (work_id, created_at DESC, user_id);

CREATE TABLE IF NOT EXISTS user_follows (
    follower_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_user_id, followed_user_id),
    CONSTRAINT user_follows_not_self CHECK (follower_user_id <> followed_user_id)
);

CREATE INDEX IF NOT EXISTS user_follows_followed_created_idx ON user_follows (followed_user_id, created_at DESC, follower_user_id);
CREATE INDEX IF NOT EXISTS user_follows_follower_created_idx ON user_follows (follower_user_id, created_at DESC, followed_user_id);

CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    CONSTRAINT user_blocks_not_self CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_created_idx ON user_blocks (blocked_user_id, created_at DESC, blocker_user_id);

CREATE TABLE IF NOT EXISTS user_notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
    notification_type text NOT NULL,
    work_id text REFERENCES published_works(id) ON DELETE SET NULL,
    target_path text NOT NULL,
    summary text NOT NULL DEFAULT '',
    dedup_key text NOT NULL,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_notifications_type CHECK (notification_type IN ('work_like', 'user_follow'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_dedup_idx ON user_notifications (user_id, dedup_key);
CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx ON user_notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_notifications_unread_idx ON user_notifications (user_id, created_at DESC, id DESC) WHERE read_at IS NULL;
`;
