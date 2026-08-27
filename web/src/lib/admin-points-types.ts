export type AdminPointRecordType = "consume" | "refund" | "credit" | "admin-adjust";
export type AdminPointDirection = "credit" | "debit";

export type AdminPointIdentity = {
    accountId?: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
    status?: "active" | "disabled";
};

export type AdminPointLedgerItem = {
    id: string;
    type: AdminPointRecordType;
    amount: string;
    balanceAfter: string;
    description: string;
    model?: string;
    sourceRecordId?: string;
    createdAt: string;
    user?: AdminPointIdentity;
    operator?: AdminPointIdentity;
};

export type AdminPointSummary = {
    settledBalance: string;
    heldBalance: string;
    availableBalance: string;
    recordCount: number;
};

export type AdminPointLedgerResult = {
    items: AdminPointLedgerItem[];
    total: number;
    page: number;
    pageSize: number;
    summary: AdminPointSummary;
};

export type AdminPointUserOption = AdminPointIdentity & {
    value: string;
    settledBalance: string;
    heldBalance: string;
    availableBalance: string;
};
