export const GENERATION_WORKER_SCHEMA_VERSION = "20260916_agent_runtime_v2";
export const GENERATION_WORKER_RUNTIME_PROTOCOL_VERSION = "1";

export type GenerationWorkerCompatibility = {
    buildVersion: string;
    gitSha: string;
    schemaVersion: string;
    runtimeProtocolVersion: string;
};

export function readGenerationWorkerCompatibility(request: Request): GenerationWorkerCompatibility {
    return {
        buildVersion: request.headers.get("x-vozeb-pro-worker-build-version")?.trim() || "",
        gitSha: request.headers.get("x-vozeb-pro-worker-git-sha")?.trim() || "",
        schemaVersion: request.headers.get("x-vozeb-pro-worker-schema-version")?.trim() || "",
        runtimeProtocolVersion: request.headers.get("x-vozeb-pro-worker-runtime-protocol")?.trim() || "",
    };
}

export function isGenerationWorkerCompatible(metadata: GenerationWorkerCompatibility) {
    const expectedGitSha = process.env.VOZEB_PRO_GIT_SHA?.trim() || "";
    return (
        metadata.buildVersion === (process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "v0.0.6") &&
        metadata.schemaVersion === GENERATION_WORKER_SCHEMA_VERSION &&
        metadata.runtimeProtocolVersion === GENERATION_WORKER_RUNTIME_PROTOCOL_VERSION &&
        (!expectedGitSha || metadata.gitSha === expectedGitSha)
    );
}
