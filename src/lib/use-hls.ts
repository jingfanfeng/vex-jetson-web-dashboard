import { MutableRefObject, useEffect } from "react";
import Hls from "hls.js";

/**
 * Attach an HLS stream to a video element.
 *
 * Falls back to assigning the URL directly when native HLS playback is available.
 */
const useHls = (
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  source?: string
) => {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) {
      return undefined;
    }

    let hls: Hls | undefined;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 2,
      });
      hls.loadSource(source);
      hls.attachMedia(video);
    } else {
      video.src = source;
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [videoRef, source]);
};

export default useHls;
