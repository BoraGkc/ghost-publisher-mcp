declare module '@tryghost/admin-api' {
  type Resource = {
    browse(options?: Record<string, unknown>): Promise<any>;
    read(data: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>;
    add(data: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>;
    edit(data: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>;
  };

  export default class GhostAdminAPI {
    constructor(config: { url: string; key: string; version: string });
    posts: Resource;
    tags: Resource;
    images: { upload(data: unknown): Promise<any> };
    site: { read(): Promise<any> };
  }
}
