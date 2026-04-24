import type { FileTreeEntry } from '../types/workspace';

export interface KamaluBase {
  id: string;
  name: string;
  slug: string;
  base_path: string;
  created_at: string;
}

export interface KamaluConfig {
  server: string;
  baseId: string;
  baseName: string;
  profile?: string;
  lastSeqNo: number;
}

function headers(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchBases(serverUrl: string, token: string): Promise<KamaluBase[]> {
  const res = await fetch(`${serverUrl}/api/bases`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Failed to fetch bases: ${res.status}`);
  const data = await res.json() as { bases: KamaluBase[] };
  return data.bases;
}

export async function fetchDirectory(
  serverUrl: string,
  token: string,
  baseId: string,
  path: string,
): Promise<FileTreeEntry[]> {
  const url = `${serverUrl}/api/bases/${baseId}/files?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(`Failed to list directory: ${res.status}`);
  const data = await res.json() as { entries: Array<{ name: string; path: string; isDirectory: boolean }> };
  return data.entries.map((e) => ({
    name: e.name,
    path: e.path,
    isDirectory: e.isDirectory,
  }));
}

export async function fetchFileContent(
  serverUrl: string,
  token: string,
  baseId: string,
  path: string,
): Promise<string> {
  const url = `${serverUrl}/api/bases/${baseId}/file?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(`Failed to read file: ${res.status}`);
  return res.text();
}

export async function createBase(
  serverUrl: string,
  token: string,
  name: string,
  slug?: string,
): Promise<KamaluBase> {
  const res = await fetch(`${serverUrl}/api/bases`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ name, slug }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Failed to create base: ${res.status}`);
  }
  return res.json() as Promise<KamaluBase>;
}

export async function uploadFile(
  serverUrl: string,
  token: string,
  baseId: string,
  path: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${serverUrl}/api/bases/${baseId}/file`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Failed to upload file: ${res.status}`);
  }
}

export async function createRemoteFolder(
  serverUrl: string,
  token: string,
  baseId: string,
  path: string,
): Promise<void> {
  const res = await fetch(`${serverUrl}/api/bases/${baseId}/folder`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Failed to create folder: ${res.status}`);
  }
}
