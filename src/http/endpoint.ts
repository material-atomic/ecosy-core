/** Central registry for grouping endpoint URLs by service name. */
export class Endpoint {
  private static registered: Record<string, Record<string, string>> = {};

  static register(service: string, endpoints: Record<string, string>) {
    this.registered[service] = { ...endpoints };
    return this;
  }

  static all() {
    return { ...this.registered };
  }
}
