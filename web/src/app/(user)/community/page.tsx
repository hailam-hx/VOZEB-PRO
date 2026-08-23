import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { loadGallery, parseGalleryFilters } from "@/app/gallery/gallery-data";
import { GalleryView } from "@/app/gallery/gallery-view";

type CommunitySearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("public");
    return { title: t("gallery"), robots: { index: false, follow: false } };
}

export default async function CommunityPage({ searchParams }: { searchParams: CommunitySearchParams }) {
    const filters = parseGalleryFilters(await searchParams);
    const gallery = await loadGallery(filters);
    return (
        <main className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
            <GalleryView filters={filters} gallery={gallery} basePath="/community" embedded />
        </main>
    );
}
