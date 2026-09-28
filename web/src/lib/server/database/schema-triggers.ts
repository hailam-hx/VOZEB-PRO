export const POSTGRESQL_TRIGGER_SCHEMA_SQL = `
CREATE OR REPLACE FUNCTION vozeb_pro_validation_history_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'model validation history is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS model_validation_verifications_immutable ON model_validation_verifications;
CREATE TRIGGER model_validation_verifications_immutable BEFORE UPDATE OR DELETE ON model_validation_verifications FOR EACH ROW EXECUTE FUNCTION vozeb_pro_validation_history_immutable();
DROP TRIGGER IF EXISTS video_validation_runs_set_updated_at ON video_validation_runs;
CREATE TRIGGER video_validation_runs_set_updated_at BEFORE UPDATE ON video_validation_runs FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS video_validation_items_set_updated_at ON video_validation_items;
CREATE TRIGGER video_validation_items_set_updated_at BEFORE UPDATE ON video_validation_items FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
CREATE OR REPLACE FUNCTION vozeb_pro_validation_item_identity_immutable() RETURNS trigger AS $$
BEGIN
    IF (OLD.run_id, OLD.binding_id, OLD.channel_id, OLD.upstream_model_id, OLD.case_id, OLD.fingerprint_version, OLD.fingerprint_hash, OLD.fingerprint_snapshot, OLD.execution_snapshot_hash, OLD.request_payload_digest, OLD.normalized_context, OLD.pricing_revision, OLD.estimated_credits, OLD.estimated_provider_cost, OLD.bound_evidence, OLD.actual_cost_capability, OLD.actual_cost_capability_evidence, OLD.idempotency_key)
       IS DISTINCT FROM
       (NEW.run_id, NEW.binding_id, NEW.channel_id, NEW.upstream_model_id, NEW.case_id, NEW.fingerprint_version, NEW.fingerprint_hash, NEW.fingerprint_snapshot, NEW.execution_snapshot_hash, NEW.request_payload_digest, NEW.normalized_context, NEW.pricing_revision, NEW.estimated_credits, NEW.estimated_provider_cost, NEW.bound_evidence, NEW.actual_cost_capability, NEW.actual_cost_capability_evidence, NEW.idempotency_key)
    THEN RAISE EXCEPTION 'video validation execution identity is immutable'; END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS video_validation_items_identity_immutable ON video_validation_items;
CREATE TRIGGER video_validation_items_identity_immutable BEFORE UPDATE ON video_validation_items FOR EACH ROW EXECUTE FUNCTION vozeb_pro_validation_item_identity_immutable();


DROP TRIGGER IF EXISTS app_settings_set_updated_at ON app_settings;
CREATE TRIGGER app_settings_set_updated_at BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS system_model_channels_set_updated_at ON system_model_channels;
CREATE TRIGGER system_model_channels_set_updated_at BEFORE UPDATE ON system_model_channels FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS wallet_holds_set_updated_at ON wallet_holds;
CREATE TRIGGER wallet_holds_set_updated_at BEFORE UPDATE ON wallet_holds FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS provider_usage_attempts_set_updated_at ON provider_usage_attempts;
CREATE TRIGGER provider_usage_attempts_set_updated_at BEFORE UPDATE ON provider_usage_attempts FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS top_up_presets_set_updated_at ON top_up_presets;
CREATE TRIGGER top_up_presets_set_updated_at BEFORE UPDATE ON top_up_presets FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS top_up_promotions_set_updated_at ON top_up_promotions;
CREATE TRIGGER top_up_promotions_set_updated_at BEFORE UPDATE ON top_up_promotions FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS top_up_coupon_templates_set_updated_at ON top_up_coupon_templates;
CREATE TRIGGER top_up_coupon_templates_set_updated_at BEFORE UPDATE ON top_up_coupon_templates FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS top_up_user_coupons_set_updated_at ON top_up_user_coupons;
CREATE TRIGGER top_up_user_coupons_set_updated_at BEFORE UPDATE ON top_up_user_coupons FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS top_up_orders_set_updated_at ON top_up_orders;
CREATE TRIGGER top_up_orders_set_updated_at BEFORE UPDATE ON top_up_orders FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS top_up_payments_set_updated_at ON top_up_payments;
CREATE TRIGGER top_up_payments_set_updated_at BEFORE UPDATE ON top_up_payments FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS top_up_payment_events_set_updated_at ON top_up_payment_events;
CREATE TRIGGER top_up_payment_events_set_updated_at BEFORE UPDATE ON top_up_payment_events FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS top_up_refunds_set_updated_at ON top_up_refunds;
CREATE TRIGGER top_up_refunds_set_updated_at BEFORE UPDATE ON top_up_refunds FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS top_up_reconciliation_runs_set_updated_at ON top_up_reconciliation_runs;
CREATE TRIGGER top_up_reconciliation_runs_set_updated_at BEFORE UPDATE ON top_up_reconciliation_runs FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS top_up_reconciliation_rows_set_updated_at ON top_up_reconciliation_rows;
CREATE TRIGGER top_up_reconciliation_rows_set_updated_at BEFORE UPDATE ON top_up_reconciliation_rows FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS referral_programs_set_updated_at ON referral_programs;
CREATE TRIGGER referral_programs_set_updated_at BEFORE UPDATE ON referral_programs FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS referral_codes_set_updated_at ON referral_codes;
CREATE TRIGGER referral_codes_set_updated_at BEFORE UPDATE ON referral_codes FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS referral_relationships_set_updated_at ON referral_relationships;
CREATE TRIGGER referral_relationships_set_updated_at BEFORE UPDATE ON referral_relationships FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS referral_rewards_set_updated_at ON referral_rewards;
CREATE TRIGGER referral_rewards_set_updated_at BEFORE UPDATE ON referral_rewards FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS published_works_set_updated_at ON published_works;
CREATE TRIGGER published_works_set_updated_at BEFORE UPDATE ON published_works FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS published_work_versions_set_updated_at ON published_work_versions;
CREATE TRIGGER published_work_versions_set_updated_at BEFORE UPDATE ON published_work_versions FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS published_work_cases_set_updated_at ON published_work_cases;
CREATE TRIGGER published_work_cases_set_updated_at BEFORE UPDATE ON published_work_cases FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
DROP TRIGGER IF EXISTS cdk_codes_set_updated_at ON cdk_codes;
CREATE TRIGGER cdk_codes_set_updated_at BEFORE UPDATE ON cdk_codes FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS announcements_set_updated_at ON announcements;
CREATE TRIGGER announcements_set_updated_at BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS prompts_set_updated_at ON prompts;
CREATE TRIGGER prompts_set_updated_at BEFORE UPDATE ON prompts FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS drama_projects_set_updated_at ON drama_projects;
CREATE TRIGGER drama_projects_set_updated_at BEFORE UPDATE ON drama_projects FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS generation_logs_set_updated_at ON generation_logs;
CREATE TRIGGER generation_logs_set_updated_at BEFORE UPDATE ON generation_logs FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS object_storage_settings_set_updated_at ON object_storage_settings;
CREATE TRIGGER object_storage_settings_set_updated_at BEFORE UPDATE ON object_storage_settings FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();

DROP TRIGGER IF EXISTS voice_profiles_set_updated_at ON voice_profiles;
CREATE TRIGGER voice_profiles_set_updated_at BEFORE UPDATE ON voice_profiles FOR EACH ROW EXECUTE FUNCTION vozeb_pro_set_updated_at();
`;
