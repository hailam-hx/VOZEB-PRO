"use client";

import { App } from "antd";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { listTopUpOrders, listTopUpPresets, type TopUpOrder, type TopUpPreset } from "@/services/api/billing";
import { listPointRecords, type PointRecord } from "@/services/api/points";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";
import { ORDER_PAGE_SIZE, RECORD_PAGE_SIZE, type ProfileSectionKey } from "./profile-elements";

export function useProfileData(activeSection: ProfileSectionKey) {
    const t = useTranslations("profile.dataErrors");
    const { message } = App.useApp();
    const setUser = useUserStore((state) => state.setUser);
    const [presets, setPresets] = useState<TopUpPreset[]>([]);
    const [presetsLoaded, setPresetsLoaded] = useState(false);
    const [presetsLoading, setPresetsLoading] = useState(false);
    const [orders, setOrders] = useState<TopUpOrder[]>([]);
    const [ordersTotal, setOrdersTotal] = useState(0);
    const [ordersPage, setOrdersPage] = useState(1);
    const [ordersLoadedPage, setOrdersLoadedPage] = useState<number | null>(null);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [pointRecords, setPointRecords] = useState<PointRecord[]>([]);
    const [pointRecordsTotal, setPointRecordsTotal] = useState(0);
    const [pointRecordsPage, setPointRecordsPage] = useState(1);
    const [pointRecordsLoadedPage, setPointRecordsLoadedPage] = useState<number | null>(null);
    const [pointRecordsLoading, setPointRecordsLoading] = useState(false);
    const [consumeRecords, setConsumeRecords] = useState<PointRecord[]>([]);
    const [consumeRecordsTotal, setConsumeRecordsTotal] = useState(0);
    const [consumeRecordsPage, setConsumeRecordsPage] = useState(1);
    const [consumeRecordsLoadedPage, setConsumeRecordsLoadedPage] = useState<number | null>(null);
    const [consumeRecordsLoading, setConsumeRecordsLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const presetsRequest = useRef(false);
    const ordersRequestPage = useRef<number | null>(null);
    const pointsRequestPage = useRef<number | null>(null);
    const consumptionRequestPage = useRef<number | null>(null);

    const loadPresets = useCallback(async () => {
        if (presetsRequest.current) return;
        presetsRequest.current = true;
        setPresetsLoading(true);
        try {
            setPresets((await listTopUpPresets()).presets);
        } catch {
            setPresets([]);
            message.error(t("presets"));
        } finally {
            setPresetsLoaded(true);
            setPresetsLoading(false);
            presetsRequest.current = false;
        }
    }, [message, t]);

    const loadOrders = useCallback(
        async (page: number) => {
            if (ordersRequestPage.current !== null) return;
            ordersRequestPage.current = page;
            setOrdersLoading(true);
            try {
                const payload = await listTopUpOrders({ page, pageSize: ORDER_PAGE_SIZE });
                setOrders(payload.orders);
                setOrdersTotal(payload.total);
                setOrdersLoadedPage(page);
            } catch {
                setOrders([]);
                setOrdersTotal(0);
                setOrdersLoadedPage(page);
                message.error(t("orders"));
            } finally {
                ordersRequestPage.current = null;
                setOrdersLoading(false);
            }
        },
        [message, t],
    );

    const loadPointRecords = useCallback(
        async (page: number) => {
            if (pointsRequestPage.current !== null) return;
            pointsRequestPage.current = page;
            setPointRecordsLoading(true);
            try {
                const payload = await listPointRecords({ page, pageSize: RECORD_PAGE_SIZE });
                setPointRecords(payload.records);
                setPointRecordsTotal(payload.total);
                setPointRecordsLoadedPage(page);
            } catch {
                message.error(t("points"));
            } finally {
                pointsRequestPage.current = null;
                setPointRecordsLoading(false);
            }
        },
        [message, t],
    );

    const loadConsumeRecords = useCallback(
        async (page: number) => {
            if (consumptionRequestPage.current !== null) return;
            consumptionRequestPage.current = page;
            setConsumeRecordsLoading(true);
            try {
                const payload = await listPointRecords({ page, pageSize: RECORD_PAGE_SIZE, direction: "debit" });
                setConsumeRecords(payload.records);
                setConsumeRecordsTotal(payload.total);
                setConsumeRecordsLoadedPage(page);
            } catch {
                message.error(t("consumption"));
            } finally {
                consumptionRequestPage.current = null;
                setConsumeRecordsLoading(false);
            }
        },
        [message, t],
    );

    const needsOrders = activeSection === "overview" || activeSection === "orders";
    const ordersTargetPage = activeSection === "overview" ? 1 : ordersPage;
    const needsPoints = activeSection === "overview" || activeSection === "points";
    const pointsTargetPage = activeSection === "overview" ? 1 : pointRecordsPage;

    useEffect(() => {
        if (activeSection === "billing" && !presetsLoaded) void loadPresets();
    }, [activeSection, loadPresets, presetsLoaded]);
    useEffect(() => {
        if (needsOrders && ordersLoadedPage !== ordersTargetPage) void loadOrders(ordersTargetPage);
    }, [loadOrders, needsOrders, ordersLoadedPage, ordersTargetPage]);
    useEffect(() => {
        if (needsPoints && pointRecordsLoadedPage !== pointsTargetPage) void loadPointRecords(pointsTargetPage);
    }, [loadPointRecords, needsPoints, pointRecordsLoadedPage, pointsTargetPage]);
    useEffect(() => {
        if (activeSection === "consume" && consumeRecordsLoadedPage !== consumeRecordsPage) void loadConsumeRecords(consumeRecordsPage);
    }, [activeSection, consumeRecordsLoadedPage, consumeRecordsPage, loadConsumeRecords]);

    const refreshUser = useCallback(async () => {
        try {
            const payload = (await (await fetch("/api/auth/session", { cache: "no-store" })).json()) as { user?: LocalUser | null };
            if (payload.user) setUser(payload.user);
        } catch {
            // The visible account data can still refresh if session projection refresh fails.
        }
    }, [setUser]);

    const refresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const requests: Promise<void>[] = [refreshUser()];
            if (activeSection === "overview") requests.push(loadOrders(1), loadPointRecords(1));
            else if (activeSection === "billing") requests.push(loadPresets());
            else if (activeSection === "orders") requests.push(loadOrders(ordersPage));
            else if (activeSection === "consume") requests.push(loadConsumeRecords(consumeRecordsPage));
            else if (activeSection === "points") requests.push(loadPointRecords(pointRecordsPage));
            await Promise.all(requests);
        } finally {
            setRefreshing(false);
        }
    }, [activeSection, consumeRecordsPage, loadConsumeRecords, loadOrders, loadPointRecords, loadPresets, ordersPage, pointRecordsPage, refreshUser]);

    return {
        presets: { items: presets, loading: presetsLoading || (activeSection === "billing" && !presetsLoaded), refresh: loadPresets },
        orders: { items: orders, total: ordersTotal, page: ordersPage, setPage: setOrdersPage, loading: ordersLoading || (needsOrders && ordersLoadedPage !== ordersTargetPage) },
        points: { items: pointRecords, total: pointRecordsTotal, page: pointRecordsPage, setPage: setPointRecordsPage, loading: pointRecordsLoading || (needsPoints && pointRecordsLoadedPage !== pointsTargetPage) },
        consumption: { items: consumeRecords, total: consumeRecordsTotal, page: consumeRecordsPage, setPage: setConsumeRecordsPage, loading: consumeRecordsLoading || (activeSection === "consume" && consumeRecordsLoadedPage !== consumeRecordsPage) },
        loading: refreshing || presetsLoading || ordersLoading || pointRecordsLoading || consumeRecordsLoading,
        refresh,
    };
}
