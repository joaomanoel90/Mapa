import { describe, expect, it } from "vitest";
import type { LatLng } from "./geo";
import {
  ELE_NOISE_M,
  elevationSummary,
  formatDuration,
  rideSummary,
  summaryDate,
  summaryTiles,
  timeSummary,
} from "./stats";

/** Pontos com altitude, para os testes de elevação. */
const comAltitude = (altitudes: number[]): LatLng[] =>
  altitudes.map((ele, i) => ({ lat: -23.5 - i * 0.0001, lng: -48.4, ele }));

describe("elevationSummary", () => {
  it("soma a subida e a descida de um morro", () => {
    // 100 m de subida e 100 m de descida
    const r = elevationSummary(comAltitude([700, 750, 800, 750, 700]));
    expect(r?.gain).toBeCloseTo(100, 6);
    expect(r?.loss).toBeCloseTo(100, 6);
    expect(r?.min).toBe(700);
    expect(r?.max).toBe(800);
  });

  it("ignora o vaivém do GPS, que somaria centenas de metros inexistentes", () => {
    // planície com erro de ±1,5 m a cada leitura: o D+ real é zero
    const ruido = Array.from({ length: 200 }, (_, i) => 500 + (i % 2 === 0 ? 1.5 : -1.5));
    const r = elevationSummary(comAltitude(ruido));
    expect(r?.gain).toBe(0);
    expect(r?.loss).toBe(0);
  });

  it("conta a subida de verdade mesmo com o ruído em cima", () => {
    // sobe 99 m em passos de 1 m, com ±1,5 m de erro em cada ponto
    const alturas: number[] = [];
    for (let i = 0; i < 100; i++) {
      alturas.push(300 + i * 1 + (i % 2 === 0 ? 1.5 : -1.5));
    }
    const r = elevationSummary(comAltitude(alturas));
    expect(r!.gain).toBeGreaterThan(95);
    expect(r!.gain).toBeLessThanOrEqual(99 + ELE_NOISE_M);
  });

  it("erra menos que o próprio limiar, sem viés nas pontas", () => {
    const alturas: number[] = [];
    for (let i = 0; i < 50; i++) alturas.push(200 + i * 4);
    const r = elevationSummary(comAltitude(alturas));
    const real = 49 * 4;
    expect(Math.abs(r!.gain - real)).toBeLessThan(ELE_NOISE_M);
  });

  it("o limiar fica acima do balanço do erro do altímetro", () => {
    // ±1,5 m de ruído anda 3 m entre leituras: o limiar precisa ser maior
    expect(ELE_NOISE_M).toBeGreaterThan(3);
  });

  it("devolve null quando não há altitude nenhuma", () => {
    expect(elevationSummary([{ lat: 0, lng: 0 }])).toBeNull();
    expect(elevationSummary([])).toBeNull();
  });

  it("usa os pontos que têm altitude, mesmo se alguns não tiverem", () => {
    const r = elevationSummary([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1, ele: 100 },
      { lat: 0, lng: 2 },
      { lat: 0, lng: 3, ele: 140 },
    ]);
    expect(r?.gain).toBe(40);
    expect(r?.min).toBe(100);
    expect(r?.max).toBe(140);
  });

  it("não inventa subida quando tudo está na mesma altura", () => {
    const r = elevationSummary(comAltitude([120, 120, 120, 120]));
    expect(r).toEqual({ gain: 0, loss: 0, min: 120, max: 120 });
  });
});

describe("timeSummary", () => {
  const T0 = Date.parse("2026-10-13T09:00:00Z");

  it("mede a duração entre as duas pontas", () => {
    const r = timeSummary([
      { lat: 0, lng: 0, t: T0 },
      { lat: 0, lng: 1, t: T0 + 30_000 },
      { lat: 0, lng: 2, t: T0 + 90_000 },
    ]);
    expect(r?.durationMs).toBe(90_000);
    expect(r?.start).toBe(T0);
  });

  it("devolve null sem hora, com uma só ou fora de ordem", () => {
    expect(timeSummary([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }])).toBeNull();
    expect(timeSummary([{ lat: 0, lng: 0, t: T0 }])).toBeNull();
    expect(
      timeSummary([
        { lat: 0, lng: 0, t: T0 + 1000 },
        { lat: 0, lng: 1, t: T0 },
      ])?.durationMs,
    ).toBe(1000); // fora de ordem: usa o menor e o maior, não a primeira e a última
  });

  it("não vira duração negativa com marcas iguais", () => {
    expect(timeSummary([{ lat: 0, lng: 0, t: T0 }, { lat: 0, lng: 1, t: T0 }])).toBeNull();
  });
});

describe("formatDuration", () => {
  it("escreve horas, minutos e segundos", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(35_000)).toBe("35 s");
    expect(formatDuration(60_000)).toBe("1 min");
    expect(formatDuration(48 * 60_000)).toBe("48 min");
    expect(formatDuration(2 * 3600_000 + 14 * 60_000)).toBe("2 h 14 min");
    expect(formatDuration(3600_000)).toBe("1 h");
  });
});

describe("summaryTiles", () => {
  const T0 = Date.parse("2026-10-13T09:00:00Z");

  it("mostra distância, elevação e tempo quando o arquivo tem tudo", () => {
    const r = rideSummary(
      [
        { lat: -23.5, lng: -48.4, ele: 700, t: T0 },
        { lat: -23.51, lng: -48.41, ele: 842, t: T0 + 3600_000 },
      ],
      71_030,
    );
    const tiras = summaryTiles(r);
    expect(tiras.map((t) => t.label)).toEqual(["distância", "elevação", "tempo"]);
    expect(tiras[0].value).toBe("71,03 km");
    expect(tiras[1].value).toBe("+142 m");
    expect(tiras[2].value).toBe("1 h");
  });

  it("sem altitude nem hora, mostra só a distância", () => {
    const r = rideSummary(
      [
        { lat: -23.5, lng: -48.4 },
        { lat: -23.51, lng: -48.41 },
      ],
      12_400,
    );
    expect(summaryTiles(r)).toEqual([{ value: "12,4 km", label: "distância" }]);
  });

  it("não mostra elevação quando não houve subida de verdade", () => {
    const r = rideSummary(comAltitude([100, 100, 100]), 5_000);
    expect(summaryTiles(r).map((t) => t.label)).toEqual(["distância"]);
  });

  it("escreve metros quando a rota é curta", () => {
    const r = rideSummary([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], 640);
    expect(summaryTiles(r)[0].value).toBe("640 m");
  });
});

describe("summaryDate", () => {
  it("escreve a data por extenso, no fuso de quem grava", () => {
    const r = rideSummary(
      [
        { lat: 0, lng: 0, t: Date.parse("2026-10-13T12:00:00Z") },
        { lat: 0, lng: 1, t: Date.parse("2026-10-13T13:00:00Z") },
      ],
      1000,
    );
    expect(summaryDate(r)).toContain("2026");
    expect(summaryDate(r)).toContain("outubro");
  });

  it("sem hora não há data", () => {
    expect(summaryDate(rideSummary([{ lat: 0, lng: 0 }], 100))).toBeNull();
  });
});

describe("rideSummary", () => {
  it("junta distância, elevação, tempo e contagem de pontos", () => {
    const pts = comAltitude([100, 150, 200]);
    const r = rideSummary(pts, 4200);
    expect(r.distanceM).toBe(4200);
    expect(r.elevation?.gain).toBe(100);
    expect(r.time).toBeNull();
    expect(r.points).toBe(3);
  });
});
