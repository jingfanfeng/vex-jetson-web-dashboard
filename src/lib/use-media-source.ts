import { MutableRefObject, useEffect } from "react";
import { config } from "../util/config";

const DEFAULT_CODEC = config.stream?.mimeCodec ?? 'video/mp4; codecs="avc1.64001f"';
const MAX_BUFFER_SECONDS = 10;
const MIN_BUFFER_SECONDS = 4;

const useMediaSourceStream = (
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  source?: string,
  mimeCodec?: string
) => {
  useEffect(() => {
    const video = videoRef.current;

    if (!video || !source) {
      return undefined;
    }

    const MediaSourceCtor = typeof window !== "undefined" ? window.MediaSource : undefined;

    if (!MediaSourceCtor) {
      // Fallback for browsers without MSE support.
      video.src = source;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    const mediaSource = new MediaSourceCtor();
    const objectUrl = URL.createObjectURL(mediaSource);
    const chunkQueue: ArrayBuffer[] = [];
    let sourceBuffer: SourceBuffer | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const abortController = new AbortController();
    let ended = false;

    video.src = objectUrl;

    const trimBuffer = (force = false) => {
      if (!sourceBuffer || sourceBuffer.updating || sourceBuffer.buffered.length === 0) {
        return;
      }

      const bufferedStart = sourceBuffer.buffered.start(0);
      const bufferedEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
      const bufferedDuration = bufferedEnd - bufferedStart;

      if (!force && bufferedDuration <= MAX_BUFFER_SECONDS) {
        return;
      }

      const targetEnd = Math.max(bufferedStart, bufferedEnd - MIN_BUFFER_SECONDS);
      if (targetEnd > bufferedStart) {
        sourceBuffer.remove(bufferedStart, targetEnd);
      }
    };

    const flushQueue = () => {
      if (!sourceBuffer || sourceBuffer.updating || chunkQueue.length === 0) {
        return;
      }

      const chunk = chunkQueue.shift();
      if (!chunk) {
        return;
      }

      try {
        sourceBuffer.appendBuffer(chunk);
      } catch (error) {
        if (error instanceof DOMException && error.name === "QuotaExceededError") {
          trimBuffer(true);
          chunkQueue.unshift(chunk);
        } else {
          console.error("[useMediaSourceStream] Failed to append buffer", error);
          chunkQueue.length = 0;
        }
      }
    };

    const closeStream = () => {
      if (ended) {
        return;
      }
      ended = true;

      abortController.abort();

      if (reader) {
        reader.cancel().catch(() => undefined);
        reader = null;
      }

      chunkQueue.length = 0;

      if (sourceBuffer) {
        try {
          if (sourceBuffer.updating) {
            sourceBuffer.abort();
          }
        } catch (error) {
          console.warn("[useMediaSourceStream] Failed to abort source buffer", error);
        }
      }

      if (mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch (error) {
          console.warn("[useMediaSourceStream] Failed to end stream", error);
        }
      }

      URL.revokeObjectURL(objectUrl);
    };

    const startStreaming = async () => {
      try {
        const response = await fetch(source, { signal: abortController.signal });
        if (!response.ok) {
          throw new Error(`Stream request failed with status ${response.status}`);
        }
        if (!response.body) {
          throw new Error("Stream response did not include a body");
        }

        reader = response.body.getReader();

        while (!ended) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          if (value && value.byteLength) {
            const copy = new Uint8Array(value.byteLength);
            copy.set(value);
            chunkQueue.push(copy.buffer);
            flushQueue();
          }
        }
      } catch (error) {
        if (!ended) {
          console.error("[useMediaSourceStream] Streaming error", error);
        }
      } finally {
        if (!ended && mediaSource.readyState === "open") {
          try {
            mediaSource.endOfStream();
          } catch (error) {
            console.warn("[useMediaSourceStream] Failed to end stream after completion", error);
          }
        }
      }
    };

    mediaSource.addEventListener("sourceopen", () => {
      if (ended) {
        return;
      }

      const mimeType = mimeCodec ?? DEFAULT_CODEC;
      if (!MediaSource.isTypeSupported(mimeType)) {
        console.error(`[useMediaSourceStream] MIME type not supported: ${mimeType}`);
        closeStream();
        return;
      }

      sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      sourceBuffer.mode = "segments";
      sourceBuffer.addEventListener("updateend", () => {
        trimBuffer();
        flushQueue();
      });
      sourceBuffer.addEventListener("error", (event) => {
        console.error("[useMediaSourceStream] SourceBuffer error", event);
        closeStream();
      });

      startStreaming();
    });

    mediaSource.addEventListener("sourceended", () => {
      closeStream();
    });

    mediaSource.addEventListener("sourceclose", () => {
      closeStream();
    });

    return () => {
      closeStream();
      video.removeAttribute("src");
      video.load();
    };
  }, [videoRef, source, mimeCodec]);
};

export default useMediaSourceStream;
