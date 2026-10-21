/**
 * Permalink da rota.
 *
 * Sem isso a rota só existe no `localStorage` de quem a criou. Aqui o estado
 * essencial (traçado, cena e paradas) é codificado no `#` da URL, o que dá
 * link compartilhável, captura de tela reproduzível e relato de bug trivial.
 *
 * O traçado NÃO é compartilhado: só os pontos clicados. A geometria é
 * recalculada pelo OSRM ao abrir — o que é o comportamento correto, já que o
 * cache de trechos é por sessão.
 *
 * A URL é entrada não confiável: tudo que chega do `#` passa por validação
 * antes de virar estado do app (ver `decodeShare`).
 */

import { DEFAULT_ENDPOINTS, type Endpoints } from "./endpoints";
import type { LatLng } from "./geo";
import type { Place } from "./geocode";
import { MAX_WAYPOINTS, DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "./settings";
import { POI_KINDS, type Poi } from "./pois";

const VERSION = 1;
const PARAM = "r";

/** Limites defensivos: nada vindo da URL pode estourar a memória. */
const MAX_POIS = 120;
const MAX_LABEL = 60;
const MAX_TEXT = 120;

/**
 * Preferências que descrevem a CENA e fazem parte do link.
 *
 * `fps`, `bitrateMbps` e `formatId` ficam de fora de propósito: dependem do
 * navegador e da máquina de quem abre, não de quem compartilha.
 */
const SHARED_KEYS = [
  "profile",
  "ignoreOneway",
  "snapToRoad",
  "showStops",
  "showStopLabels",
  "showStopCounter",
  "characterId",
  "accent",
  "rotate",
  "thirdPerson",
  "spinMap",
  "tiltHorizonte",
  "duration",
  "cameraMode",
  "followZoom",
  "basemap",
  "showRoute",
  "showTraveled",
  "showEndpoints",
  "showTitle",
  "showProgress",
  "endCard",
  "showHud",
  "minimap",
  "elevationProfile",
  "activity",
  "colorBy",
  "showKmMarks",
  "cinematic",
  "cardDistance",
  "cardElevation",
  "cardTime",
  "cardNote",
  "title",
  "subtitle",
  "aspect",
] as const;

type SharedKey = (typeof SHARED_KEYS)[number];

export type ShareData = {
  waypoints: LatLng[];
  settings: Settings;
  pois: Poi[];
  endpoints: Endpoints;
  city: Place | null;
};

/* ------------------------------------------------------------------ */
/* Polyline (algoritmo padrão, precisão de 1e-5 grau)                  */
/* ------------------------------------------------------------------ */

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(pts: LatLng[]): string {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  for (const p of pts) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += encodeSigned(lat - prevLat) + encodeSigned(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < str.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      if (i >= str.length) return out;
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      if (i >= str.length) return out;
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* base64url sobre UTF-8                                               */
/* ------------------------------------------------------------------ */

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ */
/* Codificação                                                        */
/* ------------------------------------------------------------------ */

/** Payload curto: as chaves de uma letra economizam URL. */
type Payload = {
  v: number;
  w: string;
  s?: Partial<Record<SharedKey, unknown>>;
  p?: unknown[];
  a?: [string, string] | null;
  b?: [string, string] | null;
  c?: [string, number, number];
};

function markPayload(m: { emoji: string; label: string } | null): [string, string] | null {
  // a foto não entra no link; um lugar que só tem foto não tem o que mandar
  if (!m || (!m.emoji.trim() && !m.label.trim())) return null;
  return [m.emoji, m.label];
}

/** Só as preferências que diferem do padrão entram na URL. */
function settingsDiff(settings: Settings): Payload["s"] {
  const out: Payload["s"] = {};
  for (const key of SHARED_KEYS) {
    if (settings[key] !== DEFAULT_SETTINGS[key]) {
      out[key] = settings[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Descobre o índice do tipo da parada.
 *
 * Não dá para olhar só o emoji: vários tipos repetem o mesmo (🎡 é "Feira" e
 * "Roda-gigante"), e `findIndex` devolveria sempre o primeiro. Por isso a
 * busca combina emoji, cor e nome — e, quando o usuário renomeou a parada,
 * cai para emoji + cor.
 */
function kindIndexFor(p: Poi): number {
  const exato = POI_KINDS.findIndex(
    (k) => k.emoji === p.emoji && k.color === p.color && k.name === p.label,
  );
  if (exato >= 0) return exato;
  const porAparencia = POI_KINDS.findIndex((k) => k.emoji === p.emoji && k.color === p.color);
  return porAparencia >= 0 ? porAparencia : 0;
}

function poisPayload(pois: Poi[]): unknown[] | undefined {
  if (pois.length === 0) return undefined;
  return pois.slice(0, MAX_POIS).map((p) => {
    const idx = kindIndexFor(p);
    const kind = POI_KINDS[idx];
    // [índice, gatilho] e, se houver, o rótulo e a posição.
    // O rótulo só entra quando difere do nome do tipo — o resto se reconstrói.
    const out: unknown[] = [idx, Number(p.t.toFixed(4))];
    const rotulo = p.label && p.label !== kind.name ? p.label.slice(0, MAX_LABEL) : "";
    const pos = p.pos
      ? [Number(p.pos.lat.toFixed(5)), Number(p.pos.lng.toFixed(5))]
      : null;

    if (pos) out.push(rotulo, pos);
    else if (rotulo) out.push(rotulo);
    return out;
  });
}

export function encodeShare(data: ShareData): string {
  const payload: Payload = {
    v: VERSION,
    w: encodePolyline(data.waypoints.slice(0, MAX_WAYPOINTS)),
    s: settingsDiff(data.settings),
    p: poisPayload(data.pois),
    a: markPayload(data.endpoints.a),
    b: markPayload(data.endpoints.b),
    c: data.city ? [data.city.name.slice(0, MAX_TEXT), data.city.center.lat, data.city.center.lng] : undefined,
  };
  return `${VERSION}.${toBase64Url(JSON.stringify(payload))}`;
}

/* ------------------------------------------------------------------ */
/* Decodificação (entrada não confiável)                              */
/* ------------------------------------------------------------------ */

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const cleanText = (v: unknown, max = MAX_TEXT): string | undefined =>
  typeof v === "string" ? v.slice(0, max) : undefined;

/** Descarta um ponto fora da faixa válida em vez de deixá-lo quebrar a projeção. */
function validPoint(lat: unknown, lng: unknown): LatLng | null {
  if (!isFiniteNum(lat) || !isFiniteNum(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function decodeMark(v: unknown): { emoji: string; label: string } | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const emoji = cleanText(v[0], 8) ?? "";
  const label = cleanText(v[1], MAX_LABEL) ?? "";
  return emoji.trim() || label.trim() ? { emoji, label } : null;
}

function decodePois(v: unknown): Poi[] {
  if (!Array.isArray(v)) return [];
  const out: Poi[] = [];
  for (const raw of v.slice(0, MAX_POIS)) {
    if (!Array.isArray(raw)) continue;
    const kind = POI_KINDS[Number(raw[0])];
    if (!kind) continue;
    const t = Number(raw[1]);
    if (!Number.isFinite(t)) continue;

    const third = raw[2];
    // a posição, quando existe, é o último item
    const rawPos = Array.isArray(third) ? third : raw[3];
    let pos: LatLng | undefined;
    if (Array.isArray(rawPos) && rawPos.length >= 2) {
      pos = validPoint(Number(rawPos[0]), Number(rawPos[1])) ?? undefined;
    }
    const label = cleanText(third, MAX_LABEL);

    out.push({
      id: `share-${out.length}`,
      emoji: kind.emoji,
      label: label?.trim() ? label : kind.name,
      color: kind.color,
      t: Math.max(0.01, Math.min(0.99, t)),
      pos,
    });
  }
  return out;
}

function decodeSettings(v: unknown): Partial<Settings> {
  if (typeof v !== "object" || v === null) return {};
  const input = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of SHARED_KEYS) {
    const value = input[key];
    if (value === undefined) continue;

    if (typeof DEFAULT_SETTINGS[key] === "boolean") {
      if (typeof value === "boolean") out[key] = value;
    } else if (typeof DEFAULT_SETTINGS[key] === "number") {
      if (isFiniteNum(value)) out[key] = value;
    } else if (key === "accent") {
      // só aceita cor hexadecimal: o valor vai para dentro de CSS e de canvas
      if (typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value)) out[key] = value;
    } else {
      const text = cleanText(value);
      if (text !== undefined) out[key] = text;
    }
  }

  // aproveita as validações que já existem para o localStorage
  return sanitizeSettings(out as Partial<Settings>);
}

/**
 * Lê o estado de um `hash` de URL.
 *
 * Devolve `null` quando não há nada válido — hash vazio, versão desconhecida,
 * base64 corrompido ou JSON inválido. Nunca lança: a URL vem de fora.
 */
export function decodeShare(hash: string): ShareData | null {
  try {
    // aceita tanto "#r=…" (o que `location.hash` devolve) quanto a URL inteira
    const raw = hash.includes("#") ? hash.slice(hash.indexOf("#") + 1) : hash;
    if (!raw) return null;

    const params = new URLSearchParams(raw);
    const value = params.get(PARAM);
    if (!value) return null;

    const dot = value.indexOf(".");
    if (dot < 0) return null;
    if (Number(value.slice(0, dot)) !== VERSION) return null;

    const payload = JSON.parse(fromBase64Url(value.slice(dot + 1))) as Payload;
    if (!payload || payload.v !== VERSION) return null;

    const waypoints = typeof payload.w === "string" ? decodePolyline(payload.w) : [];
    const validos = waypoints.filter((p) => validPoint(p.lat, p.lng)).slice(0, MAX_WAYPOINTS);
    if (validos.length === 0 && !payload.s && !payload.p) return null;

    const city =
      Array.isArray(payload.c) && payload.c.length >= 3
        ? (() => {
            const center = validPoint(Number(payload.c[1]), Number(payload.c[2]));
            const name = cleanText(payload.c[0]);
            return center && name
              ? ({ id: "share", name, label: name, country: "", center, zoom: 13 } as Place)
              : null;
          })()
        : null;

    return {
      waypoints: validos,
      settings: { ...DEFAULT_SETTINGS, ...decodeSettings(payload.s) },
      pois: decodePois(payload.p),
      endpoints: {
        a: decodeMark(payload.a) ?? DEFAULT_ENDPOINTS.a,
        b: decodeMark(payload.b) ?? DEFAULT_ENDPOINTS.b,
      },
      city,
    };
  } catch {
    return null;
  }
}

/**
 * Preferências vindas de um link, para sobrepor ao estado local.
 *
 * Descarta o formato de vídeo: quem compartilha não deve escolher o codec de
 * quem abre — isso depende do navegador de cada um e é redecidido ao montar.
 */
export function sharedSettingsOverrides(settings: Settings): Partial<Settings> {
  const out: Partial<Settings> = { ...settings };
  // o codec é decidido pelo navegador de quem abre, não por quem compartilha
  delete out.formatId;
  /*
   * A foto da cartela também não vem do link (são ~70 KB de texto que nenhum
   * mensageiro carrega). E, como ela não vem, o link **não pode** mexer na
   * foto de quem abre: sem esta linha, abrir um link apagava a foto que a
   * pessoa tinha escolhido.
   */
  delete out.cardPhoto;
  return out;
}

/** Monta a URL completa a partir do estado atual. */
export function buildShareUrl(data: ShareData, base?: string): string {
  const root =
    base ?? (typeof window !== "undefined" ? window.location.href.split("#")[0] : "");
  return `${root}#${PARAM}=${encodeShare(data)}`;
}
