export const PANORAMA_IMAGE_SIZE = "2048x1024";
export const PANORAMA_NODE_SIZE = { width: 340, height: 170 } as const;

const PANORAMA_PROMPT_MARKER = "\n\n[PANORAMA_OUTPUT_CONSTRAINTS]\n";

export type PanoramaPromptCopy = { withReferences: string; withoutReferences: string; constraints: string };

const DEFAULT_PANORAMA_PROMPT_COPY: PanoramaPromptCopy = {
    withReferences: "Use references only to preserve the subject, materials, colors, and spatial cues. Complete the surrounding environment without stretching the source image.",
    withoutReferences: "Build a continuous environment around the viewer from the text description.",
    constraints:
        "Output exactly one 2:1 equirectangular panorama covering 360 degrees horizontally and 180 degrees vertically, with the viewer at the center. Keep the horizon near the vertical center, join the left and right edges seamlessly, and fully render the sky or ceiling and the ground or floor. Do not create a regular banner, circular fisheye border, multi-image collage, text, watermark, interface elements, or visible seams.",
};

export function buildPanoramaPrompt(prompt: string, hasReferences: boolean, copy: PanoramaPromptCopy = DEFAULT_PANORAMA_PROMPT_COPY) {
    const basePrompt = prompt.split(PANORAMA_PROMPT_MARKER)[0].trim();
    return `${basePrompt}${PANORAMA_PROMPT_MARKER}${hasReferences ? copy.withReferences : copy.withoutReferences} ${copy.constraints}`.trim();
}

export function isPanoramaRatio(width: number, height: number) {
    return width > 0 && height > 0 && Math.abs(width / height - 2) <= 0.02;
}
