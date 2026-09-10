import { Provider } from "@/components/provider";
import type { Metadata } from "next";
import "./global.css";

export const metadata: Metadata = {
  title: {
    default: "HOTX AI 文档",
    template: "%s | HOTX AI 文档",
  },
  description:
    "HOTX AI - AI创意工作台官方文档，提供图片、视频、音频、短剧等多种AI生成能力的完整指南。",
  keywords: [
    "HOTX AI",
    "AI创意",
    "图片生成",
    "视频生成",
    "短剧制作",
    "AI工作台",
    "文档",
  ],
  authors: [{ name: "HOTX AI Team" }],
  creator: "HOTX AI Team",
  publisher: "HOTX AI",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001",
  ),
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    title: "HOTX AI 文档",
    description: "HOTX AI - AI创意工作台官方文档",
    siteName: "HOTX AI 文档",
    images: ["/hx-favicon.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "HOTX AI 文档",
    description: "HOTX AI - AI创意工作台官方文档",
    images: ["/hx-favicon.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
