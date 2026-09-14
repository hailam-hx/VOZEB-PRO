import { createParser } from "eventsource-parser";

// Internal stream cleanup reasons; never serialized into public events.
export const TEXT_STREAM_COMPLETED = Symbol.for("vozeb.text-stream.completed");
export const TEXT_STREAM_FAILED = Symbol.for("vozeb.text-stream.failed");

export function createTextSseDecoder(onData: (data: string) => void) {
    const decoder = new TextDecoder();
    const parser = createParser({ onEvent: (event) => onData(event.data) });
    return {
        push: (chunk: Uint8Array) => parser.feed(decoder.decode(chunk, { stream: true })),
        finish() {
            parser.feed(decoder.decode());
            parser.reset({ consume: true });
        },
    };
}
