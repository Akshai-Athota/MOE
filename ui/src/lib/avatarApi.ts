/** Avatars ("remembered forever"): backend hilde/avatar.py, endpoints /avatar/*. */
import type { Answer as BackendAnswer } from "./avatarTypes";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export interface AvatarMeta {
  id: string;
  name: string;
  persona_id?: string | null;
  label: string;
  created: string;
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

export const avatarApi = {
  status: () => fetch(`${BASE}/avatar/status`).then((r) => json<{ voice: boolean; cuda?: boolean; hint?: string }>(r)),
  list: () => fetch(`${BASE}/avatar`).then((r) => json<AvatarMeta[]>(r)),
  photoUrl: (id: string) => `${BASE}/avatar/${id}/photo`,
  create: (f: { name: string; personaId?: string; consent: boolean; photo: File; voice: Blob; voiceName: string }) => {
    const fd = new FormData();
    fd.append("name", f.name);
    fd.append("consent", String(f.consent));
    if (f.personaId) fd.append("persona_id", f.personaId);
    fd.append("photo", f.photo, f.photo.name);
    fd.append("voice", f.voice, f.voiceName);
    return fetch(`${BASE}/avatar`, { method: "POST", body: fd }).then((r) => json<AvatarMeta>(r));
  },
  ask: (id: string, question: string, userId: string) =>
    fetch(`${BASE}/avatar/${id}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, user_id: userId }),
    }).then((r) => json<{ avatar: AvatarMeta; answer: BackendAnswer; lang: string }>(r)),
  /** WAV in the avatar's voice -> object URL for an <audio> element */
  speak: async (id: string, text: string, lang = "de") => {
    const r = await fetch(`${BASE}/avatar/${id}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`);
    return URL.createObjectURL(await r.blob());
  },
  remove: (id: string) => fetch(`${BASE}/avatar/${id}`, { method: "DELETE" }).then((r) => json<{ deleted: string }>(r)),
};
