# 🧭 RotaCast

Trace uma rota no mapa, escolha o personagem, marque as paradas e exporte tudo em vídeo — **100% no navegador**, sem servidor próprio e sem chave de API.

---

## 🚀 Como publicar

### 1. Gerar o site

```bash
npm install
npm run build
```

Isso cria **um único arquivo**: `dist/index.html` (~546 kB, 163 kB comprimido).
Todo o JavaScript e CSS ficam embutidos nele — **não existem outros arquivos para subir**.

### 2. Escolher onde hospedar

Qualquer hospedagem de site estático serve. Da mais rápida para a mais completa:

| Opção | Como fazer | Custo |
|---|---|---|
| **Netlify Drop** | Acesse [app.netlify.com/drop](https://app.netlify.com/drop) e **arraste a pasta `dist`** para a página. Sai no ar em segundos, com HTTPS. | Grátis |
| **Cloudflare Pages** | Painel → Workers & Pages → *Upload assets* → arraste a pasta `dist`. | Grátis |
| **Vercel** | `npm i -g vercel` e depois `vercel --prod` na raiz do projeto. | Grátis |
| **GitHub Pages** | Já configurado: `.github/workflows/deploy.yml` builda e publica sozinho a cada push na `main`. | Grátis |
| **Hospedagem própria** | Envie `dist/index.html` por FTP para a pasta pública (`public_html`, `www`…). | Varia |

#### Configuração para Netlify / Vercel / Cloudflare

Se conectar direto ao repositório Git, use:

- **Comando de build:** `npm run build`
- **Diretório de publicação:** `dist`

#### GitHub Pages automático

O workflow já está no repositório em `.github/workflows/deploy.yml`: a cada push na `main`
ele roda `npm ci`, `npm run build` e publica a pasta `dist`.

Ele também **configura a origem do Pages sozinho** para "GitHub Actions" — a origem antiga
("Deploy from a branch") publica a raiz do repositório, que contém o código-fonte do Vite
(`index.html` apontando para `/src/main.tsx`) em vez do site compilado. O navegador não executa
`.tsx` nem resolve os pacotes do `node_modules` — a página abre em branco.

> Se o log do workflow mostrar o aviso *"Não foi possível trocar a origem do Pages
> automaticamente"*, faça uma vez em **Settings → Pages → Source: GitHub Actions**.

---

## ⚠️ Pontos de atenção

### Precisa ser HTTPS

O app consome mapas e rotas por HTTPS. Se a página for servida em HTTP simples, o navegador
**bloqueia** essas chamadas (conteúdo misto) e o mapa não carrega.
Todas as opções da tabela acima já entregam HTTPS automaticamente.

### Não abra o arquivo direto do disco

Abrir `dist/index.html` com duplo clique (`file://`) faz o navegador barrar as requisições de
mapa. Para testar localmente, use:

```bash
npm run preview
```

### Gravação de vídeo

Há **dois motores**, escolhidos automaticamente:

| Motor | Como funciona | Quando é usado |
|---|---|---|
| **Rápida (WebCodecs)** | Renderiza os quadros o mais rápido que a máquina conseguir, com timestamp exato via `VideoEncoder`, e monta o arquivo com `mp4-muxer`/`webm-muxer` | Padrão, quando o navegador sabe codificar o formato escolhido |
| **Tempo real (`MediaRecorder`)** | `canvas.captureStream()` gravando enquanto a animação roda | Fallback, ou quando você desliga o interruptor ⚡ |

A diferença é grande: um vídeo de 14 s sai **em poucos segundos** no motor rápido, e o `fps` do
arquivo é exatamente o escolhido — no tempo real, um quadro perdido vira engasgo. O motor rápido
também não precisa da aba visível.

Cada formato tem um codec associado: MP4 usa H.264, WebM usa VP9 ou VP8. Se o navegador recusar
o codec do formato escolhido, a exportação cai para tempo real sozinha, sem erro na tela.

No **iPhone/iPad o suporte costuma ser melhor pelo WebCodecs** do que pelo `MediaRecorder` — se a
exportação rápida não estiver disponível e o botão aparecer desabilitado, é o limite do navegador.
A pré-visualização funciona em todos.

### Serviços gratuitos usados

| Serviço | Para quê | Limite |
|---|---|---|
| OpenStreetMap, CyclOSM, OpenTopoMap, Esri | Mapas | Uso moderado (política de *fair use*) |
| OSRM (`routing.openstreetmap.de`) | Traçado das rotas e encaixe nas ruas | Demonstração pública |
| Nominatim | Busca de cidades | ~1 requisição por segundo |

Nenhum exige cadastro ou chave. São mantidos por projetos comunitários e adequados a **uso
pessoal ou de baixo tráfego**. Se o site virar algo com muitos acessos por dia, o correto é
migrar para um provedor com plano próprio (MapTiler, Stadia Maps, Geoapify, Mapbox) — basta
trocar as URLs em `src/lib/tiles.ts` e `src/lib/routing.ts`.

### Créditos obrigatórios

As licenças (ODbL, CC-BY-SA) exigem atribuição. O app **já desenha o crédito automaticamente**
no canto do mapa e dentro do vídeo exportado — não remova.

---

## 🛰️ GPX (importar e exportar)

O app lê e escreve GPX 1.1 — o formato que Strava, Garmin, Komoot e afins usam.
Fica na seção **Traçar a rota**, no painel.

**Importar (📂):** escolha um `.gpx` e a rota aparece pronta, com os pontos soltos
(`<wpt>`) virando paradas do percurso. O tipo de cada parada é deduzido do
símbolo (`<sym>`, padrão Garmin) ou do próprio nome — "Church" e "Igreja Matriz"
viram ⛪ Igreja, "Fuel" e "Posto Ipiranga" viram ⛽ Posto.

**Exportar (⬇️):** baixa a rota atual com o traçado e as paradas. Altitude
(`<ele>`) e hora (`<time>`) são lidas na importação e devolvidas na exportação,
então o ciclo importar → exportar não perde nada — e o arquivo exportado continua
servindo para quem treina.

### Dois detalhes que valem saber

**O traçado importado não é recalculado.** Um track gravado já segue as ruas, então
repassá-lo pelo roteador mudaria a rota e gastaria chamadas ao servidor comunitário
à toa. O arquivo é usado exatamente como veio. Assim que você mover, adicionar ou
remover um ponto, o roteador volta a mandar.

### Cartela final

Nos últimos segundos do vídeo aparece um resumo do percurso:

```
      49 km          +1.676 m        3 h 19 min
     DISTÂNCIA        ELEVAÇÃO          TEMPO
              13 de outubro de 2026
```

Cada número vem do **próprio arquivo** — distância do traçado, elevação do `<ele>`,
tempo e data do `<time>`, os dois últimos campos que o Strava e o Garmin gravam em
todo ponto e que antes eram ignorados. Se o arquivo não tiver altitude, a coluna
some; numa rota desenhada à mão sobra só a distância, em vez de aparecer um zero
sem significado. O botão 🏁 no painel liga e desliga, e o painel mostra os mesmos
números antes de exportar.

**A subida acumulada passa por um corte de ruído.** O altímetro oscila a cada
leitura, e somar tudo cru inventa elevação que não existe — numa pedalada de teste
com ruído de ±1,5 m:

| | elevação |
|---|---|
| somando tudo cru | 3.538 m ❌ |
| com o corte (o que o app mostra) | **1.676 m** |
| valor real da simulação | 1.684 m |

O corte é pelo **balanço** do erro: uma oscilação de ±1,5 m anda 3 m entre leituras,
então o limiar de 4 m fica acima disso e o vaivém não conta. A referência só anda
quando a variação passa do limiar, o que mantém o erro do total abaixo do próprio
limiar — em vez de acumular o erro das pontas, como faria um suavizado.

### Quantos pontos sobrevivem

São três números diferentes, e vale não confundir:

| Etapa | Limite | Por quê |
|---|---|---|
| Leitura do arquivo | 100.000 pontos | um GPX maior que isso é amostrado uniformemente |
| Traçado desenhado | 12.000 pontos | teto de desempenho da tela e do vídeo |
| Paradas (pinos) | 3.000 | são pontos de **controle**; acima de 150 viram pontos no mapa, e o roteador recebe até 99 trechos por requisição |
| Arquivo exportado | **o mesmo que entrou** | exportar devolve o traçado importado inteiro |

Um track de GPS comum — uma pedalada de 1 h gravando a cada segundo, ~3.600 pontos —
aparece inteiro, sem simplificação. E o ciclo importar → exportar **não perde nada**:
o que sai é fiel ao que entrou, mesmo quando o arquivo é grande demais para desenhar.

> Os pinos não são um corte do traçado: são só os pontos de controle que dá para
> arrastar. O painel mostra "Pontos do traçado" separado de "Paradas" por isso.

Quando o traçado importado é maior do que 12.000 pontos, ele passa por
simplificação Douglas–Peucker: a tolerância é ajustada por busca binária até caber,
preservando as curvas. O arquivo original continua guardado para a exportação.

> O GPX guarda 6 casas decimais (~11 cm), o que é mais preciso do que o formato
> costuma trazer.

### Segurança

O XML é entrada não confiável, então o parser recusa DTD (vetor de expansão de
entidades), limita a 100 mil pontos e valida cada coordenada — inclusive
descartando pontos sem os dois atributos, já que `Number(null)` é `0` e um
`<trkpt>` sem `lat` acabaria no equador.

### Desempenho do desenho

A rota é redesenhada a cada quadro da animação, e o renderizador **descarta o que
está fora da tela** antes de projetar: a janela visível vira uma caixa de
coordenadas (4 chamadas de projeção inversa por quadro) e cada segmento é testado
por comparação simples. A projeção — que usa `sin` e `log` — fica reservada para o
que realmente aparece.

Com a câmera acompanhando o personagem no zoom 16, a janela mostra uns 3 km; numa
rota de 70 km isso é ~4% dos pontos. Medido, por quadro:

| Pontos | Antes | Depois |
|---|---|---|
| 1.200 | 0,145 ms | **0,039 ms** |
| 12.000 | — | **0,047 ms** |

Ou seja: 10× mais pontos no traçado **e** mais rápido do que antes.

### Muitos pinos

Um pino comum é um marcador do Leaflet com alça de arrasto — um elemento no DOM.
Alguns milhares deles travam o arrasto e a rolagem, então acima de **150 pinos** o
mapa desenha os pontos no canvas (milhares cabem de uma vez) e só seguem marcadores
de verdade a **partida**, a **chegada** e o **pino escolhido**: clicar num pino o
promove a marcador arrastável, que é como se edita um ponto específico numa rota
longa.

O outro lado são as requisições ao servidor de rotas. Uma por trecho seria
impraticável: 60 pinos eram 59 requisições, e 3.000 pinos seriam **2.999**. Como o
OSRM aceita até 100 coordenadas por requisição, o app manda as paradas em
**punhados de 99 trechos** e depois corta a geometria devolvida nas paradas, para
guardar cada trecho no cache com o seu próprio traçado:

| Pinos | Requisições (antes) | Requisições (agora) |
|---|---|---|
| 60 | 59 | **1** |
| 300 | 299 | **4** |
| 3.000 | 2.999 | **31** |

Arrastar um pino continua custando quase nada: só os dois trechos que encostam nele
saem do cache — e, sendo vizinhos, vão numa requisição só.

Quando o servidor recusa o punhado inteiro (e não é limite de uso), ele é dividido
ao meio e cada metade é tentada de novo, para uma parada problemática não jogar o
traçado todo para a linha reta. Quando é limite de uso (429), dividir só
multiplicaria requisições — o punhado vira linha reta e o aviso aparece na tela.

---

## 🔗 Compartilhar a rota

O botão **🔗 Compartilhar** no topo gera um link que reabre a rota inteira:
traçado, paradas (inclusive as que ficam fora da rota), partida/chegada, título,
duração, estilo de mapa e personagem.

O que **não** vai no link: as configurações que dependem do aparelho — `fps`,
bitrate e formato de vídeo. Quem abre escolhe as suas.

O traçado é redesenhado pelo OSRM ao abrir o link (só os pontos clicados viajam),
com precisão de ~1 m, que é a do formato. Um exemplo real de 12 pontos e 3 paradas
fica em **~430 caracteres**.

Como a URL vem de fora, tudo que chega pelo `#` passa por validação antes de
virar estado: coordenadas fora da faixa, cores fora do formato hexadecimal,
tipos de parada inexistentes, textos longos e listas gigantes são descartados
ou cortados.

---

## 🧪 Testes e verificação

```bash
npm run typecheck  # tsc --noEmit
npm test           # Vitest (268 casos)
npm run check:dist # o build saiu autocontido e sem /src/?
```

O `npm run build` roda o `tsc` antes do Vite — o Vite **não** faz verificação de
tipos, então sem isso um erro de tipo chegaria em produção sem aviso.

O `check:dist` existe por causa de um incidente: o GitHub Pages já publicou a
raiz do repositório no lugar do build, servindo o `index.html` que aponta para
`/src/main.tsx`. O navegador não executa `.tsx` e o site abria em branco. A
checagem transforma aquele erro silencioso em falha de CI.

O workflow `.github/workflows/ci.yml` roda tudo isso em cada push na `main` e em
pull requests.

---

## 🗺️ Rodando localmente

```bash
npm install
npm run dev      # desenvolvimento, com recarga automática
npm run preview  # testa o build final
```

---

## 📁 Estrutura

```
src/
├─ App.tsx                  orquestra estado, rota, animação e exportação
├─ components/
│  ├─ MapView.tsx           mapa Leaflet, pinos e arrastar-soltar
│  ├─ Sidebar.tsx           painel de controle em 6 passos
│  ├─ CitySearch.tsx        busca de cidades (Nominatim)
│  ├─ StopEditor.tsx        catálogo e edição das paradas
│  ├─ EndpointEditor.tsx    partida e chegada como locais marcados
│  ├─ Timeline.tsx          linha do tempo da pré-visualização
│  └─ ExportModal.tsx       gravação e download do vídeo
└─ lib/
   ├─ renderer.ts           desenha cada quadro do vídeo no canvas
   ├─ webcodecs.ts          exportação rápida (VideoEncoder + muxer)
   ├─ recorder.ts           gravação em tempo real (MediaRecorder)
   ├─ routing.ts            rotas OSRM por trecho, com cache
   ├─ tiles.ts              mapas gratuitos e filtros de estilo
   ├─ geo.ts                matemática geográfica e projeção
   ├─ pins.ts               quando o pino vira ponto no mapa
   ├─ pois.ts               paradas do percurso
   ├─ stats.ts              distância, elevação (com corte de ruído) e tempo
   ├─ gpx.ts                importar/exportar GPX, simplificação de traçado
   ├─ share.ts              permalink da rota (codifica/valida o #r=…)
   └─ geocode.ts            busca de cidades
```
