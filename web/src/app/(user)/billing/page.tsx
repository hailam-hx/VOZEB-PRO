import { redirect } from "next/navigation";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ preset?: string | string[]; amount?: string | string[] }> }) {
    const params = await searchParams;
    const preset = Array.isArray(params.preset) ? params.preset[0] : params.preset;
    const amount = Array.isArray(params.amount) ? params.amount[0] : params.amount;
    const query = new URLSearchParams({ section: "billing" });
    if (preset?.trim()) query.set("preset", preset.trim());
    if (amount?.trim()) query.set("amount", amount.trim());
    redirect(`/profile?${query.toString()}`);
}
