"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import type { Asset, AssetKind } from "@/lib/library-asset-contract";
import { listLibraryAssetPage } from "@/services/api/library-assets";

export function useAssetPage(input: { userId: string; page: number; pageSize: number; kind: AssetKind | "all"; keyword: string }) {
    const t = useTranslations("media.assetsPage");
    const [assets, setAssets] = useState<Asset[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reloadToken, setReloadToken] = useState(0);
    const [keyword, setKeyword] = useState(input.keyword.trim());

    useEffect(() => {
        const timer = setTimeout(() => setKeyword(input.keyword.trim()), 220);
        return () => clearTimeout(timer);
    }, [input.keyword]);

    useEffect(() => {
        if (!input.userId) {
            setAssets([]);
            setTotal(0);
            setError("");
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        setError("");
        void listLibraryAssetPage(
            {
                page: input.page,
                pageSize: input.pageSize,
                kind: input.kind === "all" ? undefined : input.kind,
                keyword,
            },
            controller.signal,
        )
            .then((result) => {
                setAssets(result.assets);
                setTotal(result.total);
            })
            .catch((reason) => {
                if (reason instanceof DOMException && reason.name === "AbortError") return;
                setAssets([]);
                setTotal(0);
                setError(t("loadFailed"));
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [input.kind, input.page, input.pageSize, input.userId, keyword, reloadToken, t]);

    const reload = useCallback(() => setReloadToken((value) => value + 1), []);
    return { assets, total, loading, error, reload };
}
