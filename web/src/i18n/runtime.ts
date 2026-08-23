import enUS from "antd/locale/en_US";
import viVN from "antd/locale/vi_VN";
import zhCN from "antd/locale/zh_CN";

import { isChineseOnlyPath, localeMetadata, type AppLocale } from "@/i18n/config";

export { localeMetadata };

export const antLocales = {
    vi: viVN,
    en: enUS,
    "zh-CN": zhCN,
} as const;

export function effectiveLocale(locale: AppLocale, pathname: string): AppLocale {
    return isChineseOnlyPath(pathname) ? "zh-CN" : locale;
}
