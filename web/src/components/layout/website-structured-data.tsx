"use client";

import { usePathname } from "next/navigation";
import { matchSeoRoute } from "@/i18n/routing";

export function WebsiteStructuredData({ json, nonce }: { json: string; nonce?: string }) {
    const pathname = usePathname();
    if (matchSeoRoute(pathname)?.published) return null;
    return <script id="website-json-ld" nonce={nonce} suppressHydrationWarning type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
