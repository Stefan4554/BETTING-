/** Minimal stand-ins for next/server so the app's API route handlers run in the browser. */
export class NextRequest extends Request {
  nextUrl: URL;
  constructor(input: string | URL, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(this.url);
  }
}
export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
  static redirect(url: string | URL, status = 307) {
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }
  static next() {
    return new NextResponse(null);
  }
}
