import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workerScript = fileURLToPath(new URL("./generation-worker.mjs", import.meta.url));

describe("generation worker startup", () => {
    it("starts only maintenance lanes backed by current PAYG routes", () => {
        const preload = `
            const calls = [];
            globalThis.fetch = (input) => {
                calls.push(String(input));
                if (calls.length === 1) queueMicrotask(() => {
                    process.stdout.write(JSON.stringify(calls));
                    process.exit(0);
                });
                return new Promise(() => {});
            };
        `;
        const output = execFileSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, workerScript], {
            encoding: "utf8",
            env: {
                ...process.env,
                VOZEB_PRO_GENERATION_WORKER_LANES: "2",
                VOZEB_PRO_WORKER_API_ORIGIN: "http://worker.test",
                VOZEB_PRO_WORKER_TOKEN: "w".repeat(32),
            },
        });
        const calls = JSON.parse(output.slice(output.indexOf("[")));

        expect(calls).toEqual([
            "http://worker.test/api/maintenance/generation-tasks/heartbeat",
            "http://worker.test/api/maintenance/usage-holds/run",
            "http://worker.test/api/maintenance/generation-tasks/run",
            "http://worker.test/api/maintenance/generation-tasks/run",
        ]);
    });
});
