export const DEFAULT_SITE_TITLE = "HOTX AI";
export const DEFAULT_SITE_LOGO_URL = "/hx-favicon.png";
export const DEFAULT_SITE_ICON_URL = DEFAULT_SITE_LOGO_URL;

export function resolveSiteTitle(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SITE_TITLE;
}
