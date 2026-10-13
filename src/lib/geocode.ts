import type { LatLng } from "./geo";

/**
 * Busca de cidades via Nominatim (OpenStreetMap) — gratuito, sem chave de API.
 * Política de uso: no máximo 1 requisição por segundo, por isso há debounce
 * no componente e cache local aqui.
 */

export type Place = {
  id: string;
  name: string;
  /** "São Paulo, São Paulo, Brasil" */
  label: string;
  country: string;
  center: LatLng;
  /** caixa delimitadora [sul, norte, oeste, leste] */
  bbox?: [number, number, number, number];
  /** zoom sugerido quando não há bbox */
  zoom: number;
};

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const cache = new Map<string, Place[]>();

function titleize(s: string) {
  return s.trim();
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  const url =
    `${ENDPOINT}?format=jsonv2&addressdetails=1&limit=6&accept-language=pt-BR` +
    `&featureType=settlement&q=${encodeURIComponent(q)}`;

  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Busca indisponível (HTTP ${res.status})`);
  const data = (await res.json()) as NominatimResult[];

  const places: Place[] = data.map((r) => {
    const a = r.address ?? {};
    const city =
      a.city || a.town || a.village || a.municipality || a.county || r.name || r.display_name;
    const region = a.state || a.region || "";
    const country = a.country || "";
    const parts = [titleize(city), region, country].filter(Boolean);
    const bbox = r.boundingbox
      ? ([
          Number(r.boundingbox[0]),
          Number(r.boundingbox[1]),
          Number(r.boundingbox[2]),
          Number(r.boundingbox[3]),
        ] as [number, number, number, number])
      : undefined;
    return {
      id: `${r.osm_type ?? "n"}${r.osm_id ?? r.place_id}`,
      name: titleize(city),
      label: parts.join(", "),
      country,
      center: { lat: Number(r.lat), lng: Number(r.lon) },
      bbox,
      zoom: 13,
    };
  });

  cache.set(key, places);
  return places;
}

type NominatimResult = {
  place_id?: number;
  osm_id?: number;
  osm_type?: string;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  boundingbox?: [string, string, string, string];
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    region?: string;
    country?: string;
  };
};

/** Cidade padrão do app — o mapa sempre abre aqui. */
export const HOME_CITY: Place = {
  id: "angatuba",
  name: "Angatuba",
  label: "Angatuba, SP, Brasil",
  country: "Brasil",
  center: { lat: -23.4903, lng: -48.4128 },
  zoom: 15,
};

/** Cidades populares — atalhos que não consomem a API. */
export const QUICK_CITIES: Place[] = [
  HOME_CITY,
  { id: "sp", name: "São Paulo", label: "São Paulo, SP, Brasil", country: "Brasil", center: { lat: -23.5613, lng: -46.6565 }, zoom: 13 },
  { id: "rj", name: "Rio de Janeiro", label: "Rio de Janeiro, RJ, Brasil", country: "Brasil", center: { lat: -22.9711, lng: -43.1822 }, zoom: 13 },
  { id: "bh", name: "Belo Horizonte", label: "Belo Horizonte, MG, Brasil", country: "Brasil", center: { lat: -19.9245, lng: -43.9352 }, zoom: 13 },
  { id: "poa", name: "Porto Alegre", label: "Porto Alegre, RS, Brasil", country: "Brasil", center: { lat: -30.0346, lng: -51.2177 }, zoom: 13 },
  { id: "cwb", name: "Curitiba", label: "Curitiba, PR, Brasil", country: "Brasil", center: { lat: -25.4284, lng: -49.2733 }, zoom: 13 },
  { id: "rec", name: "Recife", label: "Recife, PE, Brasil", country: "Brasil", center: { lat: -8.0476, lng: -34.877 }, zoom: 13 },
  { id: "ssa", name: "Salvador", label: "Salvador, BA, Brasil", country: "Brasil", center: { lat: -12.9777, lng: -38.5016 }, zoom: 13 },
  { id: "bsb", name: "Brasília", label: "Brasília, DF, Brasil", country: "Brasil", center: { lat: -15.7939, lng: -47.8828 }, zoom: 12 },
  { id: "lis", name: "Lisboa", label: "Lisboa, Portugal", country: "Portugal", center: { lat: 38.7223, lng: -9.1393 }, zoom: 13 },
  { id: "nyc", name: "Nova York", label: "Nova York, EUA", country: "EUA", center: { lat: 40.7484, lng: -73.9857 }, zoom: 13 },
  { id: "par", name: "Paris", label: "Paris, França", country: "França", center: { lat: 48.8566, lng: 2.3522 }, zoom: 13 },
  { id: "tok", name: "Tóquio", label: "Tóquio, Japão", country: "Japão", center: { lat: 35.6762, lng: 139.6503 }, zoom: 13 },
];
