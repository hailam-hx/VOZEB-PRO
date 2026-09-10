import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const docsRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(docsRoot, "..");
const targetFiles = [
  join(repositoryRoot, "README.md"),
  join(docsRoot, "src/app/(home)/page.tsx"),
  join(docsRoot, "src/lib/layout.shared.tsx"),
  ...walk(join(docsRoot, "content")),
];
const approvedScreenshots = new Set([
  "docs/public/screenshots/pages/01-home.webp",
  "docs/public/screenshots/pages/02-create.webp",
  "docs/public/screenshots/pages/30-admin-site.webp",
]);
const consumers = new Map();
const remoteImages = new Map();

for (const file of targetFiles) {
  const source = readFileSync(file, "utf8");
  const consumer = relative(repositoryRoot, file);
  for (const imageSource of imageSources(source)) {
    if (/^https?:\/\//.test(imageSource)) {
      remoteImages.set(imageSource, [
        ...(remoteImages.get(imageSource) ?? []),
        consumer,
      ]);
      continue;
    }
    const asset = resolveImagePath(imageSource, file);
    consumers.set(asset, [...(consumers.get(asset) ?? []), consumer]);
  }
}

const localAssets = [...consumers.keys()].sort();
const unexpectedScreenshots = localAssets.filter(
  (asset) =>
    asset.startsWith("docs/public/screenshots/pages/") &&
    !approvedScreenshots.has(asset),
);
const missingAssets = localAssets.filter(
  (asset) => !existsSync(resolve(repositoryRoot, asset)),
);

for (const asset of localAssets) {
  console.log(`${asset}: ${[...new Set(consumers.get(asset))].join(", ")}`);
}
for (const [asset, files] of remoteImages) {
  console.log(`remote ${asset}: ${[...new Set(files)].join(", ")}`);
}

if (unexpectedScreenshots.length || missingAssets.length) {
  if (unexpectedScreenshots.length)
    console.error(
      `Unreviewed screenshot embeds: ${unexpectedScreenshots.join(", ")}`,
    );
  if (missingAssets.length)
    console.error(`Missing local image assets: ${missingAssets.join(", ")}`);
  process.exitCode = 1;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(?:md|mdx)$/u.test(entry.name) ? [path] : [];
  });
}

function imageSources(source) {
  const matches = new Set();
  for (const match of source.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/gu))
    matches.add(match[1]);
  for (const match of source.matchAll(
    /\bsrc\s*=\s*["']([^"']+\.(?:avif|gif|jpe?g|png|svg|webp))(?:\?[^"']*)?["']/giu,
  ))
    matches.add(match[1]);
  for (const match of source.matchAll(
    /\bsrc\s*:\s*["']([^"']+\.(?:avif|gif|jpe?g|png|svg|webp))["']/giu,
  ))
    matches.add(match[1]);
  return matches;
}

function resolveImagePath(imageSource, consumer) {
  if (imageSource.startsWith("/")) return `docs/public${imageSource}`;
  return relative(repositoryRoot, resolve(consumer, "..", imageSource));
}
