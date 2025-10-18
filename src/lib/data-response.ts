import { Decoder } from "@msgpack/msgpack";

export const STATUS_CONNECTED = 0x00000001;

export interface DataResponse {
  command?: string;
  valid?: boolean;
  cameraOffset?: Offset;
  color?: Color;
  depth?: Color;
  detections?: Detection[];
  position?: Position;
  stats?: Statistics;
  gpsOffset?: Offset;
  colorCorrection?: ColorCorrection;
}

export interface Offset {
  off_x?: number;
  off_y?: number;
  off_z?: number;
  unit?: string;
  heading_offset?: number;
  elevation_offset?: number;
}

export interface ColorCorrection {
  h?: number;
  s?: number;
  v?: number;
}

export interface Color {
  image?: Image;
}

export interface Image {
  valid?: boolean;
  width?: number;
  height?: number;
  data?: string;
}

export interface Detection {
  class_id?: number;
  prob?: number;
  depth?: number;
  screen_location?: ScreenLocation;
  map_location?: MapLocation;
}

export interface MapLocation {
  x?: number[];
  y?: number[];
  z?: number[];
}

export interface ScreenLocation {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface Position {
  status?: number;
  x?: number;
  y?: number;
  z?: number;
  azimuth?: number;
  elevation?: number;
  rotation?: number;
  connected?: boolean;
}

export interface Statistics {
  fps?: number;
  invoke_time?: number;
  video_width?: number;
  video_height?: number;
  run_time?: number;
  gps_connected?: boolean;
  cpu_temp?: number;
}

export interface RawDetection {
  x: number;
  y: number;
  center: number[];
  width: number;
  height: number;
  prob: number;
  classId: number;
}

export interface RecordInputMap {
  Position: Position;
  Offset: Offset;
  Statistics: Statistics;
  ColorCorrection: ColorCorrection;
  Detection: Detection;
  ImageDetection: ScreenLocation;
  MapDetection: MapLocation;
  AIRecord: {
    position: Position;
    detections?: Detection[];
    stats?: Statistics;
    color?: Color;
    depth?: Color;
  };
  Color: Color;
  Image: Image;
}

type RecordOutputMap = {
  Position: Position;
  Offset: Offset;
  Statistics: Statistics;
  ColorCorrection: ColorCorrection;
  Detection: Detection;
  ImageDetection: ScreenLocation;
  MapDetection: MapLocation;
  AIRecord: Partial<DataResponse>;
  Color: Color;
  Image: Image;
};

export type RecordName = keyof RecordInputMap;

export type RecordEnvelope<Name extends RecordName = RecordName> = {
  name: Name;
} & Record<string, unknown>;

type SupportedTypedArray =
  | Float32Array
  | Float64Array
  | Int32Array
  | Int16Array
  | Int8Array
  | Uint32Array
  | Uint16Array
  | Uint8Array;

type NumpyContainer = {
  nd: boolean;
  type: string | string[];
  data: Uint8Array | number[] | SupportedTypedArray | ArrayBuffer;
  shape?: number[];
  kind?: string | Uint8Array | null;
};

const utf8Decoder =
  typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

let decoderPatched = false;

function unwrapSocketMessagePayload(value: unknown): unknown {
  let current: unknown = value;

  while (Array.isArray(current) && current.length > 0) {
    const [eventName, ...rest] = current;

    if (typeof eventName !== "string") {
      break;
    }

    if (eventName.toLowerCase() !== "message") {
      break;
    }

    if (rest.length === 0) {
      return null;
    }

    current = rest.length === 1 ? rest[0] : rest;
  }

  return current;
}

function isPossibleObj(
  value: unknown[]
): value is Array<[string | number, unknown]> {
  if (value.length === 0) {
    return false;
  }

  return value.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      (typeof entry[0] === "string" || typeof entry[0] === "number")
  );
}

type DecodeBinaryFn = (
  this: Decoder,
  byteLength: number,
  headOffset: number
) => unknown;

function patchDecoderForBinaryKeys(): void {
  if (decoderPatched) {
    return;
  }

  const originalDecodeBinary = (
    Decoder.prototype as unknown as { decodeBinary: DecodeBinaryFn }
  ).decodeBinary;

  (Decoder.prototype as unknown as {
    decodeBinary: DecodeBinaryFn;
  }).decodeBinary = function patchedDecodeBinary(
    this: Decoder,
    byteLength: number,
    headOffset: number
  ) {
    const value = originalDecodeBinary.call(this, byteLength, headOffset);
    const isMapKey =
      typeof (this as unknown as { stateIsMapKey?: () => boolean }).stateIsMapKey ===
      "function"
        ? (this as unknown as { stateIsMapKey: () => boolean }).stateIsMapKey()
        : false;

    if (isMapKey && value instanceof Uint8Array) {
      return bytesToUtf8(value);
    }

    return value;
  };

  decoderPatched = true;
}

patchDecoderForBinaryKeys();

export function deserializeDataResponse(payload: unknown): DataResponse | null {
  if (payload == null) {
    return null;
  }

  const normalized = normalize(unwrapSocketMessagePayload(payload));
  return buildDataResponse(normalized);
}

export function decodeRecord<Name extends RecordName>(
  record: RecordEnvelope<Name>
): RecordOutputMap[Name] | null {
  return recordDecoders[record.name](record);
}

export function encodeRecord<Name extends RecordName>(
  name: Name,
  value: RecordInputMap[Name]
): RecordEnvelope<Name> {
  const encoder = recordEncoders[name];

  if (!encoder) {
    throw new Error(`Unsupported record name: ${String(name)}`);
  }

  const raw = encoder(value);
  const payload = cleanPayload(raw);

  return { name, ...payload } as RecordEnvelope<Name>;
}

function normalize(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    if (isPossibleObj(value)) {
      const obj: Record<string, unknown> = {};
      value.forEach(([key, nested]) => {
        obj[String(key)] = normalize(nested);
      });
      return obj;
    }

    return value.map(normalize);
  }

  if (isTypedArray(value)) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (value instanceof DataView) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    );
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [key, nested] of value.entries()) {
      obj[String(key)] = normalize(nested);
    }
    return obj;
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;

    if (isNumpyContainer(source)) {
      return normalize(decodeNumpyContainer(source));
    }

    const result: Record<string, unknown> = {};
    Object.entries(source).forEach(([key, nested]) => {
      result[key] = normalize(nested);
    });

    return result;
  }

  return value;
}

function buildDataResponse(raw: unknown): DataResponse | null {
  if (raw == null) {
    return null;
  }

  if (Array.isArray(raw)) {
    const target: DataResponse = {};

    raw.forEach((entry) => {
      if (
        entry &&
        typeof entry === "object" &&
        "name" in (entry as Record<string, unknown>)
      ) {
        mergeRecord(target, entry as RecordEnvelope);
      } else {
        mergeValue(target, entry);
      }
    });

    return target;
  }

  if (typeof raw === "object") {
    if ("name" in (raw as Record<string, unknown>)) {
      const target: DataResponse = {};
      mergeRecord(target, raw as RecordEnvelope);
      return target;
    }

    const target: DataResponse = {};
    Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
      mergeKeyValue(target, key, value);
    });

    return target;
  }

  return null;
}

const recordDecoders: {
  [K in RecordName]: (record: RecordEnvelope<K>) => RecordOutputMap[K] | null;
} = {
  AIRecord: (record) => decodeAIRecord(record),
  Position: (record) => decodePosition(record),
  Offset: (record) => decodeOffset(record),
  Statistics: (record) => decodeStats(record),
  ColorCorrection: (record) => decodeColorCorrection(record),
  Detection: (record) => decodeDetection(record),
  ImageDetection: (record) => decodeScreenLocation(record),
  MapDetection: (record) => decodeMapLocation(record),
  Color: (record) => decodeColor(record),
  Image: (record) => decodeImage(record),
};

const recordHandlers: {
  [K in RecordName]: (
    target: DataResponse,
    record: RecordEnvelope<K>,
    originKey?: string
  ) => void;
} = {
  AIRecord(target, record) {
    const partial = recordDecoders.AIRecord(record);
    if (partial) {
      assignDefined(target, partial);
    }
  },
  Position(target, record) {
    const position = recordDecoders.Position(record);
    if (position) {
      target.position = position;
    }
  },
  Offset(target, record, originKey) {
    const offset = recordDecoders.Offset(record);
    if (!offset) {
      return;
    }

    if (originKey) {
      const key = originKey.toLowerCase();
      if (key.includes("gps")) {
        target.gpsOffset = offset;
        return;
      }
      if (key.includes("camera")) {
        target.cameraOffset = offset;
        return;
      }
    }

    if (!target.cameraOffset) {
      target.cameraOffset = offset;
    } else if (!target.gpsOffset) {
      target.gpsOffset = offset;
    }
  },
  Statistics(target, record) {
    const stats = recordDecoders.Statistics(record);
    if (stats) {
      target.stats = stats;
    }
  },
  ColorCorrection(target, record) {
    const correction = recordDecoders.ColorCorrection(record);
    if (correction) {
      target.colorCorrection = correction;
    }
  },
  Detection(target, record) {
    const detection = recordDecoders.Detection(record);
    if (!detection) {
      return;
    }
    if (!target.detections) {
      target.detections = [];
    }
    target.detections.push(detection);
  },
  ImageDetection() {
    // handled within Detection decoder
  },
  MapDetection() {
    // handled within Detection decoder
  },
  Color(target, record, originKey) {
    const color = recordDecoders.Color(record);
    if (!color) {
      return;
    }
    if (originKey && originKey.toLowerCase().includes("depth")) {
      target.depth = color;
    } else {
      target.color = color;
    }
  },
  Image(target, record, originKey) {
    const image = recordDecoders.Image(record);
    if (!image) {
      return;
    }
    const colorRecord: Color = { image };
    if (originKey && originKey.toLowerCase().includes("depth")) {
      target.depth = colorRecord;
    } else {
      target.color = colorRecord;
    }
  },
};

const recordEncoders: {
  [K in RecordName]: (value: RecordInputMap[K]) => Record<string, unknown>;
} = {
  Position: (value) => encodePositionRecord(value),
  Offset: (value) => encodeOffsetRecord(value),
  Statistics: (value) => encodeStatsRecord(value),
  ColorCorrection: (value) => encodeColorCorrectionRecord(value),
  Detection: (value) => encodeDetectionRecord(value),
  ImageDetection: (value) => encodeImageDetectionRecord(value),
  MapDetection: (value) => encodeMapDetectionRecord(value),
  AIRecord: (value) => encodeAIRecordRecord(value),
  Color: (value) => encodeColorRecord(value),
  Image: (value) => encodeImageRecord(value),
};

function mergeValue(target: DataResponse, value: unknown, originKey?: string): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if ("name" in (value as Record<string, unknown>)) {
    mergeRecord(target, value as RecordEnvelope, originKey);
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
    mergeKeyValue(target, key, nested);
  });
}

function mergeKeyValue(target: DataResponse, key: string, value: unknown): void {
  switch (key) {
    case "Command":
    case "command":
      if (value != null) {
        target.command = String(value);
      }
      return;
    case "Message":
    case "message":
      if (value != null) {
        target.command = String(value);
      }
      return;
    case "Valid":
    case "valid":
      target.valid = asBoolean(value);
      return;
    case "CameraOffset":
    case "cameraOffset":
    case "camera_offset":
      target.cameraOffset = decodeOffset(value);
      return;
    case "GpsOffset":
    case "gpsOffset":
    case "gps_offset":
      target.gpsOffset = decodeOffset(value);
      return;
    case "ColorCorrection":
    case "colorCorrection":
    case "color_correction":
      target.colorCorrection = decodeColorCorrection(value);
      return;
    case "Color":
    case "color":
      target.color = decodeColor(value);
      return;
    case "Depth":
    case "depth":
      target.depth = decodeColor(value);
      return;
    case "Detections":
    case "detections":
      target.detections = decodeDetections(value);
      return;
    case "Position":
    case "position":
      target.position = decodePosition(value);
      return;
    case "Stats":
    case "stats":
      target.stats = decodeStats(value);
      return;
    default:
      mergeValue(target, value, key);
  }
}

function mergeRecord(
  target: DataResponse,
  record: RecordEnvelope,
  originKey?: string
): void {
  const handler = recordHandlers[record.name as RecordName] as
    | ((target: DataResponse, record: RecordEnvelope, originKey?: string) => void)
    | undefined;
  if (handler) {
    handler(target, record, originKey);
  }
}

function decodeAIRecord(value: unknown): Partial<DataResponse> | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  const partial: Partial<DataResponse> = {};

  if (data.position !== undefined) {
    const position = decodePosition(data.position);
    if (position) {
      partial.position = position;
    }
  }

  if (data.detections !== undefined) {
    const detections = decodeDetections(data.detections);
    if (detections.length > 0) {
      partial.detections = detections;
    }
  }

  if (data.stats !== undefined) {
    const stats = decodeStats(data.stats);
    if (stats) {
      partial.stats = stats;
    }
  }

  if (data.color !== undefined) {
    const color = decodeColor(data.color);
    if (color) {
      partial.color = color;
    }
  }

  if (data.depth !== undefined) {
    const depth = decodeColor(data.depth);
    if (depth) {
      partial.depth = depth;
    }
  }

  return Object.keys(partial).length > 0 ? partial : null;
}

function decodePosition(value: unknown): Position | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  const status = asNumber(readField(data, "status", "Status"));

  const position: Position = {
    status,
    x: asNumber(readField(data, "x", "X")),
    y: asNumber(readField(data, "y", "Y")),
    z: asNumber(readField(data, "z", "Z")),
    azimuth: asNumber(readField(data, "azimuth", "Azimuth")),
    elevation: asNumber(readField(data, "elevation", "Elevation")),
    rotation: asNumber(readField(data, "rotation", "Rotation")),
  };

  if (status !== undefined) {
    position.connected = (status & STATUS_CONNECTED) === STATUS_CONNECTED;
  } else {
    const connected = asBoolean(readField(data, "connected", "Connected"));
    if (connected !== undefined) {
      position.connected = connected;
    }
  }

  return position;
}

function decodeOffset(value: unknown): Offset | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  return {
    off_x: asNumber(readField(data, "x", "X", "off_x", "offX")),
    off_y: asNumber(readField(data, "y", "Y", "off_y", "offY")),
    off_z: asNumber(readField(data, "z", "Z", "off_z", "offZ")),
    unit: asString(readField(data, "unit")),
    heading_offset: asNumber(readField(data, "heading_offset", "headingOffset")),
    elevation_offset: asNumber(
      readField(data, "elevation_offset", "elevationOffset")
    ),
  };
}

function decodeColorCorrection(value: unknown): ColorCorrection | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  const h = asNumber(readField(data, "h", "H"));
  const s = asNumber(readField(data, "s", "S"));
  const v = asNumber(readField(data, "v", "V"));

  if (h === undefined && s === undefined && v === undefined) {
    return null;
  }

  return { h, s, v };
}

function decodeColor(value: unknown): Color | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  const imageValue = readField(data, "image", "Image");
  const image = decodeImage(imageValue);

  if (!image) {
    return null;
  }

  return { image };
}

function decodeImage(value: unknown): Image | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  const width = asNumber(readField(data, "width", "Width"));
  const height = asNumber(readField(data, "height", "Height"));
  const valid = asBoolean(readField(data, "valid", "Valid"));

  let rawData = readField(data, "data", "Data");
  if (rawData instanceof Uint8Array || isTypedArray(rawData)) {
    rawData = bytesToBase64(toUint8Array(rawData as SupportedTypedArray | Uint8Array));
  } else if (
    Array.isArray(rawData) &&
    rawData.length > 0 &&
    typeof rawData[0] === "number"
  ) {
    rawData = bytesToBase64(Uint8Array.from(rawData as number[]));
  } else if (rawData != null && typeof rawData !== "string") {
    rawData = String(rawData);
  }

  return {
    valid,
    width,
    height,
    data: typeof rawData === "string" ? rawData : undefined,
  };
}

function decodeDetections(value: unknown): Detection[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => decodeDetection(entry)).filter(isNotNull);
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    if (Array.isArray(source.detections)) {
      return decodeDetections(source.detections);
    }
    if ("name" in source) {
      const detection = decodeDetection(value);
      return detection ? [detection] : [];
    }
  }

  return [];
}

function decodeDetection(value: unknown): Detection | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  const detection: Detection = {
    class_id: asNumber(readField(data, "class", "class_id", "classId")),
    prob: asNumber(readField(data, "prob", "probability")),
    depth: asNumber(readField(data, "depth")),
    screen_location: decodeScreenLocation(
      readField(data, "screenLocation", "screen_location")
    ),
    map_location: decodeMapLocation(
      readField(data, "mapLocation", "map_location")
    ),
  };

  return detection;
}

function decodeScreenLocation(value: unknown): ScreenLocation | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  return {
    x: asNumber(readField(data, "x", "X")),
    y: asNumber(readField(data, "y", "Y")),
    width: asNumber(readField(data, "width", "Width")),
    height: asNumber(readField(data, "height", "Height")),
  };
}

function decodeMapLocation(value: unknown): MapLocation | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  return {
    x: toNumericArray(readField(data, "x", "X")),
    y: toNumericArray(readField(data, "y", "Y")),
    z: toNumericArray(readField(data, "z", "Z")),
  };
}

function decodeStats(value: unknown): Statistics | null {
  const data = resolveRecord(value);
  if (!data) {
    return null;
  }

  return {
    fps: asNumber(readField(data, "fps", "FPS")),
    invoke_time: asNumber(readField(data, "infer_time", "inferTime", "InferTime")),
    video_width: asNumber(
      readField(data, "video_width", "videoWidth", "VideoWidth")
    ),
    video_height: asNumber(
      readField(data, "video_height", "videoHeight", "VideoHeight")
    ),
    run_time: asNumber(readField(data, "run_time", "runTime", "RunTime")),
    gps_connected: asBoolean(
      readField(data, "gps_connected", "gpsConnected", "GPSConnected")
    ),
    cpu_temp: asNumber(
      readField(data, "cpu_temp", "cpuTemp", "cpuTempurature", "CPUTempurature")
    ),
  };
}

function encodePositionRecord(position: Position): Record<string, unknown> {
  return {
    frame_count: 0,
    status: position.status ?? 0,
    x: position.x ?? 0,
    y: position.y ?? 0,
    z: position.z ?? 0,
    azimuth: position.azimuth ?? 0,
    elevation: position.elevation ?? 0,
    rotation: position.rotation ?? 0,
  };
}

function encodeOffsetRecord(offset: Offset): Record<string, unknown> {
  return {
    off_x: offset.off_x ?? 0,
    off_y: offset.off_y ?? 0,
    off_z: offset.off_z ?? 0,
    unit: offset.unit ?? "",
    heading_offset: offset.heading_offset ?? 0,
    elevation_offset: offset.elevation_offset ?? 0,
  };
}

function encodeStatsRecord(stats: Statistics): Record<string, unknown> {
  return {
    fps: stats.fps ?? 0,
    infer_time: stats.invoke_time ?? 0,
    video_width: stats.video_width ?? 0,
    video_height: stats.video_height ?? 0,
    run_time: stats.run_time ?? 0,
    gps_connected: stats.gps_connected ?? false,
    cpu_temp: stats.cpu_temp ?? 0,
  };
}

function encodeColorCorrectionRecord(
  correction: ColorCorrection
): Record<string, unknown> {
  return {
    h: correction.h ?? 0,
    s: correction.s ?? 0,
    v: correction.v ?? 0,
  };
}

function encodeDetectionRecord(detection: Detection): Record<string, unknown> {
  const screen =
    detection.screen_location != null
      ? encodeRecord("ImageDetection", detection.screen_location)
      : encodeRecord("ImageDetection", {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        });

  const map =
    detection.map_location != null
      ? encodeRecord("MapDetection", detection.map_location)
      : encodeRecord("MapDetection", { x: [], y: [], z: [] });

  return {
    class_id: detection.class_id ?? 0,
    probability: detection.prob ?? 0,
    depth: detection.depth ?? 0,
    screen_location: screen,
    map_location: map,
  };
}

function encodeImageDetectionRecord(
  location: ScreenLocation
): Record<string, unknown> {
  return {
    x: location.x ?? 0,
    y: location.y ?? 0,
    width: location.width ?? 0,
    height: location.height ?? 0,
  };
}

function encodeMapDetectionRecord(
  location: MapLocation
): Record<string, unknown> {
  return {
    x: encodeNumericArray(location.x),
    y: encodeNumericArray(location.y),
    z: encodeNumericArray(location.z),
  };
}

function encodeAIRecordRecord(
  record: RecordInputMap["AIRecord"]
): Record<string, unknown> {
  return {
    position: encodeRecord("Position", record.position),
    detections: (record.detections ?? []).map((det) =>
      encodeRecord("Detection", det)
    ),
    stats: record.stats ? encodeRecord("Statistics", record.stats) : undefined,
    color: record.color ? encodeRecord("Color", record.color) : undefined,
    depth: record.depth ? encodeRecord("Color", record.depth) : undefined,
  };
}

function encodeColorRecord(color: Color): Record<string, unknown> {
  return {
    image: color.image ? encodeRecord("Image", color.image) : undefined,
  };
}

function encodeImageRecord(image: Image): Record<string, unknown> {
  const dataBytes =
    typeof image.data === "string"
      ? base64ToBytes(image.data)
      : new Uint8Array(0);

  return {
    valid: Boolean(image.valid),
    width: image.width ?? 0,
    height: image.height ?? 0,
    data: dataBytes,
  };
}

function encodeNumericArray(values?: number[]): Record<string, unknown> {
  const array =
    values && values.length > 0
      ? Float32Array.from(values)
      : new Float32Array(0);

  return {
    nd: true,
    type: "<f4",
    kind: "",
    shape: [array.length],
    data: typedArrayToBytes(array),
  };
}

function resolveRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if ("name" in record) {
    const output: Record<string, unknown> = {};
    Object.keys(record).forEach((key) => {
      if (key !== "name") {
        output[key] = record[key];
      }
    });
    return output;
  }

  return record;
}

function readField(
  source: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }
  return undefined;
}

function assignDefined<T extends object>(target: T, partial: Partial<T>): void {
  Object.entries(partial as Record<string, unknown>).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      (target as Record<string, unknown>)[key] = value;
    }
  });
}

function cleanPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

function isTypedArray(value: unknown): value is SupportedTypedArray {
  return (
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof Int32Array ||
    value instanceof Int16Array ||
    value instanceof Int8Array ||
    value instanceof Uint32Array ||
    value instanceof Uint16Array ||
    value instanceof Uint8Array
  );
}

function isNumpyContainer(value: Record<string, unknown>): value is NumpyContainer {
  return (
    value != null &&
    typeof value === "object" &&
    "data" in value &&
    "type" in value &&
    "nd" in value
  );
}

function decodeNumpyContainer(container: NumpyContainer): unknown {
  const dtype =
    typeof container.type === "string"
      ? container.type
      : Array.isArray(container.type)
      ? String(container.type[0])
      : "";
  const bytes = toUint8Array(container.data);

  if (!container.nd) {
    const scalarArray = createTypedArray(dtype, bytes);
    if (scalarArray) {
      return scalarArray.length > 0 ? scalarArray[0] : undefined;
    }
    return bytes.length > 0 ? bytes[0] : undefined;
  }

  const typed = createTypedArray(dtype, bytes);
  if (!typed) {
    return Array.from(bytes);
  }

  if (!container.shape || container.shape.length === 0) {
    return Array.from(typed);
  }

  return reshapeTypedArray(typed, container.shape);
}

function createTypedArray(
  dtype: string,
  bytes: Uint8Array
): SupportedTypedArray | null {
  const normalized = dtype?.toLowerCase();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  switch (normalized) {
    case "<f4":
    case "float32":
      return new Float32Array(buffer);
    case "<f8":
    case "float64":
      return new Float64Array(buffer);
    case "<i4":
    case "int32":
      return new Int32Array(buffer);
    case "<i2":
    case "int16":
      return new Int16Array(buffer);
    case "<i1":
    case "|i1":
    case "int8":
      return new Int8Array(buffer);
    case "<u4":
    case "uint32":
      return new Uint32Array(buffer);
    case "<u2":
    case "uint16":
      return new Uint16Array(buffer);
    case "<u1":
    case "|u1":
    case "uint8":
      return new Uint8Array(buffer);
    default:
      return null;
  }
}

function reshapeTypedArray(
  array: SupportedTypedArray,
  shape: number[],
  offset = 0
): unknown {
  if (shape.length === 0) {
    return array[offset];
  }

  if (shape.length === 1) {
    const size = shape[0];
    const slice = array.subarray(offset, offset + size);
    return Array.from(slice);
  }

  const size = shape[0];
  const rest = shape.slice(1);
  const step = rest.reduce((product, dimension) => product * dimension, 1);
  const result = new Array(size);

  for (let i = 0; i < size; i += 1) {
    const start = offset + i * step;
    result[i] = reshapeTypedArray(array, rest, start);
  }

  return result;
}

function toUint8Array(
  data: Uint8Array | number[] | SupportedTypedArray | ArrayBuffer
): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (isTypedArray(data)) {
    return new Uint8Array(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    );
  }
  return Uint8Array.from(Array.isArray(data) ? data : []);
}

function toNumericArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((entry) => asNumber(entry)).filter(isFiniteNumber);
  }
  if (isTypedArray(value)) {
    const typedArray = value as SupportedTypedArray;
    const result: number[] = [];
    for (let i = 0; i < typedArray.length; i += 1) {
      const numeric = typedArray[i];
      if (!Number.isNaN(numeric)) {
        result.push(numeric);
      }
    }
    return result;
  }
  const numeric = asNumber(value);
  return numeric !== undefined ? [numeric] : [];
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isNaN(value) ? undefined : value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? undefined : numeric;
  }
  if (Array.isArray(value) && value.length > 0) {
    return asNumber(value[0]);
  }
  if (isTypedArray(value) && value.length > 0) {
    const numeric = (value as SupportedTypedArray)[0];
    return Number.isNaN(numeric) ? undefined : numeric;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return undefined;
    }
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function typedArrayToBytes(array: SupportedTypedArray): Uint8Array {
  return new Uint8Array(
    array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength)
  );
}

function bytesToUtf8(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  if (utf8Decoder) {
    return utf8Decoder.decode(bytes);
  }

  let result = "";
  for (let i = 0; i < bytes.length; i += 1) {
    result += String.fromCharCode(bytes[i]);
  }

  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  const globalBuffer = (globalThis as { Buffer?: { from: (data: Uint8Array) => { toString: (encoding: string) => string } } }).Buffer;
  if (globalBuffer?.from) {
    return globalBuffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  return binary;
}

function base64ToBytes(base64: string): Uint8Array {
  if (!base64) {
    return new Uint8Array(0);
  }

  const globalBuffer = (globalThis as { Buffer?: { from: (data: string, encoding: string) => Uint8Array } }).Buffer;
  if (globalBuffer?.from) {
    return new Uint8Array(globalBuffer.from(base64, "base64"));
  }

  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  return new Uint8Array(0);
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function isNotNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
