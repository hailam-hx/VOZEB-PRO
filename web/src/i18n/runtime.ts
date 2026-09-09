import enUS from "antd/locale/en_US";
import viVN from "antd/locale/vi_VN";
import zhCN from "antd/locale/zh_CN";

import { isChineseOnlyPath, localeMetadata, type AppLocale } from "@/i18n/config";
import { matchSeoRoute } from "@/i18n/routing";

export { localeMetadata };

export const antLocales = {
    vi: viVN,
    en: enUS,
    "zh-CN": zhCN,
} as const;

export function effectiveLocale(locale: AppLocale, pathname: string): AppLocale {
    const route = matchSeoRoute(pathname);
    return isChineseOnlyPath(pathname) ? "zh-CN" : route?.published ? route.locale : locale;
}
