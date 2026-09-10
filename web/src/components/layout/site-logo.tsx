"use client";

import { useState } from "react";

import { DEFAULT_SITE_LOGO_URL } from "@/lib/site-brand";
import { cn } from "@/lib/utils";

export function SiteLogo({ logoUrl, className }: { logoUrl: string; className?: string }) {
    const configuredLogoUrl = logoUrl.trim() || DEFAULT_SITE_LOGO_URL;
    const [failedLogoUrl, setFailedLogoUrl] = useState("");
    const source = failedLogoUrl === configuredLogoUrl ? DEFAULT_SITE_LOGO_URL : configuredLogoUrl;

    return (
        <img src={source} alt="" className={cn("shrink-0 object-contain", className)} referrerPolicy="no-referrer" onError={() => setFailedLogoUrl(configuredLogoUrl)} />
    );
}
