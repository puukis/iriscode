declare module 'ws' {
  export class WebSocket {
    static readonly OPEN: number;
    readonly readyState: number;
    send(data: string): void;
    close(): void;
    on(event: 'message', listener: (data: string | Buffer) => void): void;
    on(event: 'close', listener: () => void): void;
    on(event: 'error', listener: (error: unknown) => void): void;
  }

  export class WebSocketServer {
    constructor(options: { host?: string; port: number });
    on(event: 'connection', listener: (socket: WebSocket) => void): void;
    on(event: 'error', listener: (error: unknown) => void): void;
    close(): void;
  }
}
