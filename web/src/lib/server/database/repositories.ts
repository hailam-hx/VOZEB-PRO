import { postgresQuery, type QueryExecutor } from "@/lib/server/database/postgres";
import { AuditLogsRepository } from "./audit-log-repository";
import { TopUpRepository } from "./top-up-repository";
import { PointsWalletRepository } from "./points-wallet-repository";
import { ReferralRepository } from "./referral-repository";
import { WorkPublicationRepository } from "./work-publication-repository";
import { WorkGovernanceRepository } from "./work-governance-repository";
import { WorkCommunityRepository } from "./work-community-repository";
import { AnnouncementsRepository, GenerationLogsRepository, PromptsRepository } from "./content-repository";
import { CdkRepository, EmailCodesRepository, PointsRepository, SessionsRepository, UsersRepository } from "./user-repository";
import type { AppSettingsRecord, SystemModelChannelRecord } from "./repository-shared";
import { isoValue, jsonParam, jsonValue, numberValue, optionalJson, stringValue } from "./repository-shared";

export type {
    AuthenticatedUserRecord,
    JsonValue,
    TopUpReconciliationRowRecord,
    TopUpReconciliationRunRecord,
    ReferralCodeRecord,
    ReferralProgramRecord,
    ReferralRelationshipRecord,
    ReferralRewardRecord,
    ReferralRewardStatus,
    ReferralRiskStatus,
    PublishedWorkAssetRecord,
    PublishedWorkAuthorDisplay,
    PublishedWorkLifecycleStatus,
    PublishedWorkModerationStatus,
    PublishedWorkRecord,
    PublishedWorkSourceType,
    PublishedWorkSummaryRecord,
    PublishedWorkVersionRecord,
    PublishedWorkVisibility,
    PublishedWorkCaseRecord,
    PublishedWorkCaseStatus,
    PublishedWorkCaseSummaryRecord,
    PublishedWorkCaseType,
    PublishedGalleryItemRecord,
    PublishedWorkRankingRecord,
    UserNotificationRecord,
    UserNotificationType,
    WorkCommunityRankingCursor,
    WorkCommunityRankingWindow,
    WorkCommunityRelationResultRecord,
    WorkCommunitySummaryRecord,
    UserFollowResultRecord,
    FollowedUserRecord,
    CommunityUserRecord,
    LikedPublishedWorkRecord,
    PublicCreatorProfileRecord,
    PublicCreatorWorkCursor,
    UserCommunitySummaryRecord,
    UserSummaryRecord,
} from "./repository-shared";

export function createPostgresRepositories(executor: QueryExecutor = { query: postgresQuery }) {
    const pointsWallet = new PointsWalletRepository(executor);
    const topUps = new TopUpRepository(executor);

    return {
        topUps,
        settings: new SettingsRepository(executor),
        users: new UsersRepository(executor),
        sessions: new SessionsRepository(executor),
        emailCodes: new EmailCodesRepository(executor),
        points: new PointsRepository(executor),
        pointsWallet,
        cdk: new CdkRepository(executor),
        announcements: new AnnouncementsRepository(executor),
        prompts: new PromptsRepository(executor),
        generationLogs: new GenerationLogsRepository(executor),
        referrals: new ReferralRepository(executor),
        workPublications: new WorkPublicationRepository(executor),
        workGovernance: new WorkGovernanceRepository(executor),
        workCommunity: new WorkCommunityRepository(executor),
        auditLogs: new AuditLogsRepository(executor),
    };
}

class SettingsRepository {
    constructor(private readonly db: QueryExecutor) {}

    async lock() {
        await this.db.query("SELECT id FROM app_settings WHERE id = 'default' FOR UPDATE");
    }

    async getPaymentConfig() {
        const result = await this.db.query("SELECT payment_config FROM app_settings WHERE id = 'default'");
        return result.rows[0] ? jsonValue(result.rows[0].payment_config) : {};
    }

    async getSettings() {
        const [settings, channels] = await Promise.all([this.db.query("SELECT * FROM app_settings WHERE id = 'default'"), this.listSystemModelChannels()]);
        return {
            settings: settings.rows[0] ? mapSettings(settings.rows[0]) : undefined,
            channels,
        };
    }

    async updateSettings(input: Partial<Omit<AppSettingsRecord, "id" | "createdAt" | "updatedAt">>) {
        const assignments: string[] = [];
        const values: unknown[] = [];
        const add = (column: string, value: unknown) => {
            values.push(value);
            assignments.push(`${column} = $${values.length}`);
        };
        if (input.site !== undefined) add("site", jsonParam(input.site));
        if (input.registrationEnabled !== undefined) add("registration_enabled", input.registrationEnabled);
        if (input.emailRegistrationEnabled !== undefined) add("email_registration_enabled", input.emailRegistrationEnabled);
        if (input.mail !== undefined) add("mail", jsonParam(input.mail));
        if (input.allowUserApiConfig !== undefined) add("allow_user_api_config", input.allowUserApiConfig);
        if (input.modelPointCosts !== undefined) add("model_point_costs", jsonParam(input.modelPointCosts));
        if (input.generationPointMultipliers !== undefined) add("generation_point_multipliers", jsonParam(input.generationPointMultipliers));
        if (input.generationCostControl !== undefined) add("generation_cost_control", jsonParam(input.generationCostControl));
        if (input.dataLifecycle !== undefined) add("data_lifecycle", jsonParam(input.dataLifecycle));
        if (input.generationConcurrency !== undefined) add("generation_concurrency", jsonParam(input.generationConcurrency));
        if (input.generationDefaults !== undefined) add("generation_defaults", jsonParam(input.generationDefaults));
        if (input.paymentConfig !== undefined) add("payment_config", jsonParam(input.paymentConfig));
        if (input.logicalModels !== undefined) add("logical_models", jsonParam(input.logicalModels));
        if (input.defaultModels !== undefined) add("default_models", jsonParam(input.defaultModels));
        if (input.agentSkills !== undefined) add("agent_skills", jsonParam(input.agentSkills));
        if (!assignments.length) throw new Error("Settings update requires at least one field");
        const row = await this.db.query(`UPDATE app_settings SET ${assignments.join(", ")} WHERE id = 'default' RETURNING *`, values);
        return mapSettings(row.rows[0]);
    }

    async listSystemModelChannels() {
        const result = await this.db.query("SELECT * FROM system_model_channels ORDER BY sort_order ASC, created_at ASC");
        return result.rows.map(mapSystemModelChannel);
    }

    async getSystemModelChannelById(id: string, forUpdate = false) {
        const result = await this.db.query(`SELECT * FROM system_model_channels WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return result.rows[0] ? mapSystemModelChannel(result.rows[0]) : null;
    }

    async upsertSystemModelChannel(channel: Omit<SystemModelChannelRecord, "createdAt" | "updatedAt">) {
        const result = await this.db.query(
            `
            INSERT INTO system_model_channels (id, name, base_url, api_key_ciphertext, webhook_secret_ciphertext, api_format, models, enabled, advanced_config, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                base_url = EXCLUDED.base_url,
                api_key_ciphertext = EXCLUDED.api_key_ciphertext,
                webhook_secret_ciphertext = EXCLUDED.webhook_secret_ciphertext,
                api_format = EXCLUDED.api_format,
                models = EXCLUDED.models,
                enabled = EXCLUDED.enabled,
                advanced_config = EXCLUDED.advanced_config,
                sort_order = EXCLUDED.sort_order
            RETURNING *
            `,
            [channel.id, channel.name, channel.baseUrl, channel.apiKeyCiphertext, channel.webhookSecretCiphertext, channel.apiFormat, jsonParam(channel.models), channel.enabled, jsonParam(channel.advancedConfig), channel.sortOrder],
        );
        return mapSystemModelChannel(result.rows[0]);
    }

    async deleteSystemModelChannelsNotIn(ids: string[]) {
        const result = await this.db.query("DELETE FROM system_model_channels WHERE id <> ALL($1::text[])", [ids]);
        return result.rowCount || 0;
    }
}

function mapSettings(row: Record<string, unknown>): AppSettingsRecord {
    return {
        id: "default",
        site: jsonValue(row.site),
        registrationEnabled: row.registration_enabled !== false,
        emailRegistrationEnabled: row.email_registration_enabled === true,
        mail: jsonValue(row.mail),
        allowUserApiConfig: row.allow_user_api_config === true,
        modelPointCosts: jsonValue(row.model_point_costs),
        generationPointMultipliers: jsonValue(row.generation_point_multipliers),
        generationCostControl: jsonValue(row.generation_cost_control),
        dataLifecycle: jsonValue(row.data_lifecycle),
        generationConcurrency: jsonValue(row.generation_concurrency),
        generationDefaults: jsonValue(row.generation_defaults),
        paymentConfig: jsonValue(row.payment_config),
        logicalModels: jsonValue(row.logical_models),
        defaultModels: jsonValue(row.default_models),
        agentSkills: jsonValue(row.agent_skills),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

function mapSystemModelChannel(row: Record<string, unknown>): SystemModelChannelRecord {
    return {
        id: stringValue(row.id),
        name: stringValue(row.name),
        baseUrl: stringValue(row.base_url),
        apiKeyCiphertext: stringValue(row.api_key_ciphertext),
        webhookSecretCiphertext: stringValue(row.webhook_secret_ciphertext),
        apiFormat: row.api_format === "gemini" ? "gemini" : "openai",
        models: jsonValue(row.models),
        enabled: row.enabled !== false,
        advancedConfig: optionalJson(row.advanced_config),
        sortOrder: numberValue(row.sort_order),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}
