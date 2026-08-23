import { decimal } from "@/lib/billing/decimal";
import type { AuthenticatedUserRecord, UserSummaryRecord } from "@/lib/server/database";

import type { AuthDatabase, PublicUser, PublicUserSummary, StoredUser } from "./store-types";

export function toPublicUser(user: StoredUser, db?: Pick<AuthDatabase, "walletHolds">): PublicUser {
    const heldBalance = db?.walletHolds.filter((hold) => hold.userId === user.id && hold.status === "active").reduce((sum, hold) => sum.plus(decimal(hold.amount)), decimal(0)).toString() || "0";
    return buildPublicUser(user, heldBalance);
}

export function publicUserFromAuthenticatedRecord(record: AuthenticatedUserRecord) {
    return buildPublicUser(record.user, record.heldBalance);
}

export function toPublicUserSummary(summary: UserSummaryRecord): PublicUserSummary;
export function toPublicUserSummary(users: StoredUser[], _defaultPlanId?: string): PublicUserSummary;
export function toPublicUserSummary(input: UserSummaryRecord | StoredUser[]): PublicUserSummary {
    if (!Array.isArray(input)) return input;
    return {
        total: input.length,
        active: input.filter((user) => user.status === "active").length,
        disabled: input.filter((user) => user.status === "disabled").length,
        admins: input.filter((user) => user.role === "admin").length,
        activeAdmins: input.filter((user) => user.role === "admin" && user.status === "active").length,
        totalSettledBalance: input.reduce((total, user) => total.plus(decimal(user.settledBalance)), decimal(0)).toString(),
    };
}

export const summarizePublicUsers = (users: PublicUser[], _defaultPlanId?: string): PublicUserSummary => ({
    total: users.length,
    active: users.filter((user) => user.status === "active").length,
    disabled: users.filter((user) => user.status === "disabled").length,
    admins: users.filter((user) => user.role === "admin").length,
    activeAdmins: users.filter((user) => user.role === "admin" && user.status === "active").length,
    totalSettledBalance: users.reduce((total, user) => total.plus(decimal(user.settledBalance)), decimal(0)).toString(),
});

export function matchesPublicUser(user: PublicUser, input: { keyword?: string; role?: string; status?: string }) {
    const keyword = input.keyword?.trim().toLowerCase();
    return (!input.role || user.role === input.role)
        && (!input.status || user.status === input.status)
        && (!keyword || [user.accountId, user.username, user.email, user.displayName].some((value) => value?.toLowerCase().includes(keyword)));
}

function buildPublicUser(user: StoredUser | AuthenticatedUserRecord["user"], heldBalance: string): PublicUser {
    const availableBalance = decimal(user.settledBalance).minus(decimal(heldBalance)).toString();
    return {
        id: user.id,
        accountId: user.accountId,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarStorageKey ? `/api/profile/avatar/${user.id}` : undefined,
        role: user.role,
        adminPermissions: user.adminPermissions,
        status: user.status,
        settledBalance: decimal(user.settledBalance).toString(),
        heldBalance: decimal(heldBalance).toString(),
        availableBalance,
        mfaEnabled: Boolean(user.mfaEnabledAt),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
    };
}
