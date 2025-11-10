import React, { useMemo } from "react";
import { Layer, Rect } from "react-konva";
import { useAppSelector } from "../../state/hooks";
import { config } from "../../util/config";
import { GridMap } from "../../lib/data-response";

interface TileRect {
  key: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

/**
 * Visualises the traversal cost grid reported by the AI brain.
 *
 * Renders the map as equally sized rectangles across the field, colouring each
 * tile according to its traversal cost so operators can quickly identify
 * blocked or high-cost regions.
 *
 * @returns JSX.Element | null
 */
const GridCostLayer = () => {
  const map: GridMap = useAppSelector(
    (state) => state.data.response?.map ?? null
  );
  const scale = useAppSelector((state) => state.app.scale);

  const tiles = useMemo(() => {
    if (
      !map ||
      !map.size ||
      !map.size.width ||
      !map.size.height ||
      !map.tiles ||
      map.tiles.length !== map.size.width * map.size.height ||
      !scale
    ) {
      return [];
    }

    const { width: gridWidth, height: gridHeight } = map.size;
    const fieldSizePx = config.field.dimension * scale;
    const cellWidthPx = fieldSizePx / gridWidth;
    const cellHeightPx = fieldSizePx / gridHeight;
    const halfField = fieldSizePx / 2;

    const getFill = (cost: number): string | null => {
      if (cost === null || cost === undefined) {
        return null;
      }
      if (cost <= 0) {
        return "rgba(210,38,48,0.55)";
      }
      if (cost < 5) {
        return "rgba(34,197,94,0.35)";
      }
      return "rgba(249,115,22,0.35)";
    };

    const shapes: TileRect[] = [];

    map.tiles.forEach((cost, index) => {
      const column = index % gridWidth;
      const row = Math.floor(index / gridWidth);
      const fill = getFill(cost);

      if (!fill) {
        return;
      }

      shapes.push({
        key: index,
        x: -halfField + column * cellWidthPx,
        y: -halfField + row * cellHeightPx,
        width: cellWidthPx,
        height: cellHeightPx,
        fill,
      });
    });

    return shapes;
  }, [map, scale]);

  if (!tiles.length) {
    return null;
  }

  return (
    <Layer listening={false}>
      {tiles.map((tile) => (
        <Rect
          key={`grid-tile-${tile.key}`}
          x={tile.x}
          y={tile.y}
          width={tile.width}
          height={tile.height}
          fill={tile.fill}
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={0.5}
          listening={false}
        />
      ))}
    </Layer>
  );
};

export default GridCostLayer;
