export const AUTH = { 'x-openid': 'mock_openid_001' };

export function req(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, init);
}

export function authed(path: string, init: RequestInit = {}) {
  return req(path, { ...init, headers: { ...AUTH, ...(init.headers as Record<string, string> | undefined) } });
}

export async function json(res: Response) {
  return res.json() as Promise<any>;
}
