declare module "pg" {
  export class Pool {
    constructor(...args: any[]);
    query(text: string, params?: any[]): Promise<{ rowCount: number; rows: any[] }>;
  }
}

