import React, { useEffect, useRef, useState } from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import ConnectingToCameraProgress from "./connecting-to-camera-progress";
import { Detection, Image } from "../../lib/data-response";
import useWindowDimensions from "../../lib/hooks";
import { Layer, Rect, Stage, Text } from "react-konva";
import { v4 as uuidv4 } from "uuid";
import { config } from "../../util/config";
import { PhotoCamera } from "@mui/icons-material";
import Konva from "konva";
import { Jimp } from "jimp";
import useHls from "../../lib/use-hls";

interface CameraProps {
  img?: Image;
  detections?: Detection[];
  streamUrl?: string;
  frameWidth?: number;
  frameHeight?: number;
}

interface SaveImageButtonProps {
  callback: () => void
}

const SaveImageButton = ({callback}: SaveImageButtonProps) => {
    return (
        <Box display="flex" justifyContent="end">
          <Tooltip title="Save Camera Image">
              <IconButton aria-label="save photo" onClick={callback}>
                  <PhotoCamera sx={{ color: "white", halign: "end"}}/>
              </IconButton>
          </Tooltip>
        </Box>
    )
}


/**
 * Displays an image and draws detection boxes around elements
 *
 * @param param0 Camera properties
 * @returns JSX.Element
 */
const Camera = ({ img, detections, streamUrl, frameWidth, frameHeight }: CameraProps) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<Konva.Stage>(null);
  const { height } = useWindowDimensions();
  const [sorted, setSorted] = useState<Detection[]>(null);
  const mediaRef = streamUrl ? videoRef : imageRef;
  const sourceWidth = frameWidth ?? img?.width ?? 1;
  const sourceHeight = frameHeight ?? img?.height ?? 1;
  const canCaptureImage = Boolean(!streamUrl && img && img.data);

  useHls(videoRef, streamUrl);

  /**
   * Sort the list of detections based on detection depth to get proper on screen layering on top of the displayed image
   */
  useEffect(() => {
    if (detections) {
      setSorted(detections.slice(0).sort((a, b) => b.depth - a.depth));
    }
  }, [detections]);

  // To save image to disk, Kanva stage must be coverted to .png and overlaid on the original image
  const cameraButtonClicked = async () => {
     if (!canCaptureImage) {
       return;
     }
     if (canvasRef.current && imageRef.current) {
      const canvasCopy: Konva.Stage = canvasRef.current.clone();
      const cameraCopy = imageRef.current.src;
      const canvasImage = await Jimp.read(canvasCopy.toDataURL({mimeType: "image/png"}));
      const cameraImage = await Jimp.read(cameraCopy);
      cameraImage.resize({w: canvasImage.width, h: canvasImage.height})
      cameraImage.composite(canvasImage);
      const base64 = await cameraImage.getBase64("image/png");

      const currentDate = new Date().toISOString();
      const link = document.createElement("a");
      link.href = base64;
      link.target = "_blank";
      link.download = `VEX_AI_${currentDate}.png`
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
     }
  }

  const mediaHeight =
    mediaRef.current && mediaRef.current["clientHeight"]
      ? mediaRef.current["clientHeight"]
      : 1;
  const mediaWidth =
    mediaRef.current && mediaRef.current["clientWidth"]
      ? mediaRef.current["clientWidth"]
      : 1;
  const widthRatio = sourceWidth > 0 && mediaWidth > 0 ? sourceWidth / mediaWidth : 1;
  const heightRatio =
    sourceHeight > 0 && mediaHeight > 0 ? sourceHeight / mediaHeight : 1;

  return (
    <Box>
      {img || streamUrl ? (
        <Box>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
            }}
          >
            {/* display the media */}
            {streamUrl ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{
                  maxHeight: height - 50,
                  maxWidth: height * 1.35,
                  width: "100%",
                  height: "100%",
                }}
              />
            ) : (
              <img
                alt=""
                src={`data:image/png;base64,${img.data}`}
                height="100%"
                width="100%"
                style={{
                  maxHeight: height - 50,
                  maxWidth: height * 1.35,
                }}
                ref={imageRef}
              />
            )}
            {/* add the canvas stage for element detections on top of the image  */}
            <Stage
              height={mediaHeight} // using the media dimensions
              width={mediaWidth} // using the media dimensions
              style={{ position: "absolute" }}
              ref={canvasRef}
            >
              {sorted ? (
                <>
                  {sorted.map((detection) => {
                    const bboxWidth = detection.screenLocation.width / widthRatio;
                    const bboxHeight =
                      detection.screenLocation.height / heightRatio;

                    const bboxX =
                      (detection.screenLocation.x *
                        mediaWidth) /
                      config.SCALE_X;
                    const bboxY =
                      (detection.screenLocation.y *
                        mediaHeight) /
                      config.SCALE_Y;

                    const classBoxWidth = bboxWidth;
                    const classBoxHeight = bboxHeight * 0.23;
                    const classBoxY = bboxY - classBoxHeight * 1.04;

                    return (
                      <>
                        {detection.depth ? ( // depth is -1 if received json detection had a depth of NaN originally
                          <Layer key={uuidv4()}>
                            {/* class box */}
                            <Rect
                              x={bboxX}
                              y={classBoxY}
                              height={classBoxHeight}
                              width={classBoxWidth}
                              fill="rgba(95, 95, 95, 0.75)"
                              stroke={config.colors.black}
                              strokeWidth={2}
                              cornerRadius={0}
                            />
                            {/* class name */}
                            <Text
                              fill={config.elements.label.textColors.white}
                              text={`${
                                config.elements.label.text[detection.class]
                              }`}
                              x={bboxX}
                              y={bboxY - classBoxHeight}
                              fontStyle="bold"
                              align="center"
                              verticalAlign="middle"
                              width={classBoxWidth}
                              height={classBoxHeight}
                              fontSize={classBoxHeight * 0.6}
                            />
                            {/* bounding box */}
                            <Rect
                              x={bboxX}
                              y={bboxY}
                              height={bboxHeight > 0 ? bboxHeight : 1}
                              width={bboxWidth > 0 ? bboxWidth : 1}
                              fill={
                                config.elements.backgroundColors[detection.class]
                              }
                              stroke={
                                config.elements.borderColors[detection.class]
                              }
                              strokeWidth={2}
                              cornerRadius={0}
                            />
                            {/* coordinates */}
                            <Text
                              fill={config.elements.label.textColors.white}
                              text={`X ${detection.mapLocation.x[0]
                                .toFixed(2)
                                .toString()}m\nY ${detection.mapLocation.y[0]
                                .toFixed(2)
                                .toString()}m`}
                              align="left"
                              verticalAlign="top"
                              x={bboxX}
                              y={bboxY}
                              padding={8}
                              width={bboxWidth}
                              height={bboxHeight}
                              fontSize={bboxHeight * 0.15}
                            />
                            {/* depth */}
                            <Text
                              fill={config.elements.label.textColors.white}
                              text={`Distance\n${detection.depth >= 0 ? detection.depth
                                .toFixed(2)
                                .toString()+"m" : "Unknown"}`}
                              align="right"
                              verticalAlign="bottom"
                              x={bboxX}
                              y={bboxY}
                              padding={8}
                              width={bboxWidth}
                              height={bboxHeight}
                              fontSize={bboxHeight * 0.15}
                            />
                          </Layer>
                        ) : null}
                      </>
                    );
                  })}
                </>
              ) : null}
            </Stage>
          </div>
          {canCaptureImage ? (
            <div>
              <SaveImageButton callback={cameraButtonClicked}/>
            </div>
          ) : null}
        </Box>
      ) : (
        <ConnectingToCameraProgress />
      )}
    </Box>
  );
};

export default Camera;
