type WebsiteStructuredDataInput = {
    locale?: string;
    name: string;
    alternateName?: string[];
    description: string;
    url: string;
    logoUrl: string;
};

type CreativeWorkStructuredDataInput = {
    visibility: "public" | "unlisted" | "private";
    url: string;
    websiteId: string;
    title: string;
    description: string;
    publishedAt: string;
    category: string;
    tags: string[];
    authorName?: string;
    imageUrl?: string;
};

type SeoLandingStructuredDataInput = {
    locale?: string;
    homeUrl?: string;
    homeName?: string;
    url: string;
    websiteId: string;
    title: string;
    description: string;
    breadcrumbName: string;
    imageUrl?: string;
};

export function serializeStructuredData(value: unknown) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildWebsiteStructuredData(input: WebsiteStructuredDataInput) {
    return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": `${input.url}#website`,
        url: input.url,
        name: input.name,
        ...(input.locale ? { inLanguage: input.locale } : {}),
        ...(input.alternateName?.length ? { alternateName: input.alternateName } : {}),
        description: input.description,
        publisher: {
            "@type": "Organization",
            "@id": `${input.url}#organization`,
            name: input.name,
            url: input.url,
            logo: { "@type": "ImageObject", url: input.logoUrl },
        },
    };
}

export function buildSeoLandingStructuredData(input: SeoLandingStructuredDataInput) {
    const homeUrl = input.homeUrl || new URL("/", input.url).toString();
    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebPage",
                "@id": `${input.url}#webpage`,
                url: input.url,
                name: input.title,
                description: input.description,
                inLanguage: input.locale || "vi",
                isPartOf: { "@id": input.websiteId },
                ...(input.imageUrl ? { primaryImageOfPage: { "@type": "ImageObject", url: input.imageUrl } } : {}),
            },
            {
                "@type": "BreadcrumbList",
                "@id": `${input.url}#breadcrumb`,
                itemListElement: [
                    { "@type": "ListItem", position: 1, name: input.homeName || "Trang chủ", item: homeUrl },
                    { "@type": "ListItem", position: 2, name: input.breadcrumbName, item: input.url },
                ],
            },
        ],
    };
}

export function buildCreativeWorkStructuredData(input: CreativeWorkStructuredDataInput) {
    if (input.visibility !== "public") return null;
    return {
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        "@id": `${input.url}#creative-work`,
        url: input.url,
        name: input.title,
        description: input.description,
        datePublished: input.publishedAt,
        genre: input.category,
        keywords: input.tags,
        ...(input.authorName ? { author: { "@type": "Person", name: input.authorName } } : {}),
        ...(input.imageUrl ? { image: input.imageUrl } : {}),
        isPartOf: { "@id": input.websiteId },
    };
}
