export interface ServedFile {
  status: number;
  type?: string;
  body?: Uint8Array;
  error?: unknown;
}

export class TileServer {
  constructor(dir: string, baseUrl: string);
  handle(path: string): Promise<ServedFile>;
}

export class PmTiles {
  static open(file: string): Promise<PmTiles>;
  header: {
    minZoom: number;
    maxZoom: number;
    bounds: [number, number, number, number];
    center: [number, number, number];
    tileType: string;
  };
  tile(z: number, x: number, y: number): Promise<Uint8Array | null>;
  metadata(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export function zxyToTileId(z: number, x: number, y: number): number;
