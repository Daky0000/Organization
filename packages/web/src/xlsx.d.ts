declare module 'xlsx' {
  export function read(data: ArrayBuffer, opts?: Record<string, unknown>): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  export const utils: {
    sheet_to_json(ws: unknown, opts?: Record<string, unknown>): Record<string, string>[];
  };
}
