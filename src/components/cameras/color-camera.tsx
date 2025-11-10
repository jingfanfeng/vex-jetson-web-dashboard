import React, { useMemo } from "react";
import { useAppSelector } from "../../state/hooks";
import Camera from "./camera";
import { config } from "../../util/config";

/**
 * Specific camera for color image data
 *
 * @returns JSX.Element
 */
const ColorCamera = () => {
  const response = useAppSelector((state) => state.data.response);
  const socketIp = useAppSelector((state) => state.settings.socketIp);

  const streamUrl = useMemo(() => {
    if (!socketIp || !config.stream?.path) {
      return undefined;
    }
    return `${config.stream.protocol}://${socketIp}:${config.stream.port}${config.stream.path}`;
  }, [socketIp]);

  return (
    <Camera
      img={response && response.color ? response.color.image : null}
      detections={response ? response.detections : null}
      streamUrl={streamUrl}
      frameWidth={
        response && response.stats && response.stats.videoWidth
          ? response.stats.videoWidth
          : response && response.color && response.color.image
          ? response.color.image.width
          : undefined
      }
      frameHeight={
        response && response.stats && response.stats.videoHeight
          ? response.stats.videoHeight
          : response && response.color && response.color.image
          ? response.color.image.height
          : undefined
      }
    />
  );
};

export default ColorCamera;
