import EventEmitter from "eventemitter3";
import { io, Socket } from "socket.io-client";
import { decode } from "@msgpack/msgpack";
import {
  ColorCorrection,
  DataResponse,
  Offset,
  deserializeDataResponse,
} from "../lib/data-response";
import { config } from "../util/config";
import { commands } from "../lib/commands";

type DataServiceEvents = {
  socketConnected: () => void;
  message: (message: DataResponse) => void;
  socketConnectionClosed: () => void;
  getCameraOffset: (message: Offset) => void;
  getGpsOffset: (message: Offset) => void;
  getColorCorrection: (message: ColorCorrection) => void;
};

/**
 * Service to get data from the websocket server on the AI module
 */
export class DataService extends EventEmitter<DataServiceEvents> {
  private timer: NodeJS.Timeout | null;
  private socket: Socket | null;
  public command: string | null;
  public ip: string;
  public port: string;

  /**
   * Constructor
   */
  constructor(_ip: string, _port: string) {
    super();
    this.ip = _ip;
    this.port = _port;
    this.timer = null;
    this.socket = null;
    this.command = null;
    this.createSocketConnection();
  }

  private decodePayload = (payload: unknown): unknown => {
    if (payload instanceof ArrayBuffer) {
      return decode(new Uint8Array(payload));
    }

    if (ArrayBuffer.isView(payload)) {
      const view = payload as ArrayBufferView;
      return decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    }

    return payload;
  };

  private handleMessage = (payload: unknown) => {
    const decoded = this.decodePayload(payload);
    const response = deserializeDataResponse(decoded);
    if (!response) {
      return;
    }

    if (config.logDataResponse) {
      console.log(response);
    }

    if (response.command === commands.gGetCameraOffset && response.cameraOffset) {
      this.emit("getCameraOffset", response.cameraOffset);
      return;
    }

    if (response.command === commands.gGetGpsOffset && response.gpsOffset) {
      this.emit("getGpsOffset", response.gpsOffset);
      return;
    }

    if (response.command === commands.gGetColorCorrection && response.colorCorrection) {
      this.emit("getColorCorrection", response.colorCorrection);
      return;
    }

    this.emit("message", response);
  };

  private startPolling = () => {
    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      if (this.command) {
        this.send(this.command);
      }
    }, config.pollingInterval);
  };

  private stopPolling = () => {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  };

  /**
   * Creates a new WebSocket
   */
  public createSocketConnection = () => {
    if (this.socket?.connected) {
      this.socket.disconnect();
    }

    const socket = io(`http://${this.ip}:${this.port}`, {
      transports: ["websocket"],
      autoConnect: true,
    });

    socket.on("connect", () => {
      this.emit("socketConnected");
      this.start();
    });

    socket.on("message", this.handleMessage);

    socket.on("disconnect", () => {
      this.stopPolling();
      this.emit("socketConnectionClosed");
    });

    socket.on("connect_error", (error) => {
      console.log(`[DataService] Failed to connect via Socket.IO - ${error}`);
    });

    this.socket = socket;
  };

  /**
   * Starts polling for data with a specified command
   *
   * Uses configurable polling interval
   */
  public start = () => {
    try {
      this.startPolling();
    } catch (ex) {
      console.log(`[Data Service] Failed to start sending commands - ${ex}`);
    }
  };

  /**
   * Stops the service
   */
  public stop = () => {
    try {
      this.stopPolling();
      if (this.socket) {
        this.socket.disconnect();
      }
    } catch (ex) {
      console.log(`[Data Service] Failed to stop the service - ${ex}`);
    }
  };

  /**
   * Restarts the service
   */
  public restart = () => {
    try {
      this.stop();
      this.createSocketConnection();
    } catch (ex) {
      console.log(`[Data Service] Failed to restart the service - ${ex}`);
    }
  };

  /**
   * Sends a message over the socket connection
   *
   * @param command The command to send to the websocket server to get specific data
   */
  public send = (command: string) => {
    try {
      if (this.socket?.connected) {
        this.socket.emit("message", command);
      }
    } catch (ex) {
      console.log(`[Data Service] Failed to send websocket message - ${ex}`);
    }
  };

  /**
   *
   */
  public getCameraOffset = () => {
    try {
      this.socket?.emit("message", commands.gGetCameraOffset);
    } catch (ex) {
      console.log(`Failed to get camera offset ${ex}`);
    }
  };

  /**
   *
   */
  public getGpsOffset = () => {
    try {
      this.socket?.emit("message", commands.gGetGpsOffset);
    } catch (ex) {
      console.log(`Failed to get gps offset ${ex}`);
    }
  };

  public getColorCorrection = () => {
    try {
      this.socket?.emit("message", commands.gGetColorCorrection);
    } catch (ex) {
      console.log(`Failed to get color correction ${ex}`)
    }
  }

  /**
   *
   */
  public setCameraOffset = (offset: string) => {
    try {
      this.socket?.emit("message", `${commands.gSetCameraOffset},${offset}`);
    } catch (ex) {
      console.log(`Failed to set camera offset ${ex}`);
    }
  };

  /**
   *
   */
  public setGpsOffset = (offset: string) => {
    try {
      this.socket?.emit("message", `${commands.gSetGpsOffset},${offset}`);
    } catch (ex) {
      console.log(`Failed to set gps offset ${ex}`);
    }
  };

  public setColorCorrection = (colorCorrection: string) => {
    try {
      this.socket?.emit("message", `${commands.gSetColorCorrection},${colorCorrection}`);
    } catch (ex) {
      console.log(`Failed to set color correction ${ex}`)
    }
  }

  /**
   * Is the service connected to the websocket server
   */
  public connected = (): boolean => {
    return this.socket ? this.socket.connected : false;
  };
}
