type PointsResponseValue = {
    settledBalance?: unknown;
    heldBalance?: unknown;
    availableBalance?: unknown;
};

export function pointsResponseHeaders(value: unknown) {
    const headers = new Headers();
    const points = typeof value === "object" && value ? (value as PointsResponseValue) : {};
    setDecimalHeader(headers, "x-vozeb-pro-balance-settled", points.settledBalance);
    setDecimalHeader(headers, "x-vozeb-pro-balance-held", points.heldBalance);
    setDecimalHeader(headers, "x-vozeb-pro-balance-available", points.availableBalance);
    return headers;
}

function setDecimalHeader(headers: Headers, name: string, value: unknown) {
    if (typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) headers.set(name, value);
}
