# 🧭 RotaCast

Trace uma rota no mapa, escolha o personagem (são **61**), marque as paradas e exporte tudo em vídeo — **100% no navegador**, sem servidor próprio e sem chave de API.

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

No **tempo real** quem carimba o tempo é a **tela**: o `MediaRecorder` entrega o quadro que estiver
desenhado no instante em que a tela o pediu. Duas coisas seguem disso, e as duas foram medidas no
arquivo de exemplo que o usuário mandou (60 s, 720×1280, 1.441 quadros):

1. **Um quadro capturado por quadro desenhado.** O caminho de sempre deixa o navegador escolher o
   instante da captura; com `captureStream(0)` + `requestFrame()` a captura sai colada no quadro que
   acabou de ser desenhado. A **cadência** é a grade do vídeo (`indiceDoQuadro`, `i/fps`).
2. **O conteúdo de cada quadro sai do relógio** (`tempoDoQuadro`), não do índice do degrau. O
   `MediaRecorder` carimba cada captura no instante em que ela aconteceu — 20 ms, 33 ms, 46 ms, o
   que a tela der —, então o desenho tem de andar no mesmo relógio. Desenhando por índice, um quadro
   que ficava 46 ms na tela carregava o mesmo passo de mapa que um de 20 ms: a velocidade aparente
   oscilava até 1,7× de um quadro para o outro, e é isso o *"travadinha em todo o vídeo"*. Medido nos
   dois mp4 do usuário (passo do mapa nos quadros longos ÷ nos curtos): **1,49×** no arquivo que
   funcionava e **1,01×** no que travava. O voo de abertura escapava porque ali o passo é de fração
   de pixel.
3. **O `fps` é ajustado para dividir a taxa da tela** (`fpsQueCasa`, medindo a tela com
   `requestAnimationFrame`) — não mais por causa da velocidade, mas para os quadros do arquivo
   ficarem igualmente espaçados. Pedir 24 numa tela de 60 Hz dá quadros de 33 ms e 50 ms
   alternados; a janela então usa **20**, que sai de 50 em 50 ms. A janela avisa quando o fps foi
   trocado.

Quando o vídeo termina, a janela diz **qual motor rodou** ("Exportação rápida (WebCodecs)" ou
"Gravação em tempo real") e, no tempo real, em que fps o arquivo saiu: é a primeira coisa a olhar se
o movimento sair picado.

Cada formato tem um codec associado: MP4 usa H.264, WebM usa VP9 ou VP8. Se o navegador recusar
o codec do formato escolhido, a exportação cai para tempo real sozinha, sem erro na tela.

No **iPhone/iPad o suporte costuma ser melhor pelo WebCodecs** do que pelo `MediaRecorder` — se a
exportação rápida não estiver disponível e o botão aparecer desabilitado, é o limite do navegador.
A pré-visualização funciona em todos.

### Som no vídeo (pops e música)

Até aqui o arquivo saía **mudo**: `video/*` puro, sem faixa de áudio. O som tem
duas camadas, e as duas evitam o problema de direitos:

| camada | de onde vem | o que marca |
|---|---|---|
| **pops** | sintetizados no app, nota por nota | a largada, **cada parada** passada e a chegada |
| **música** | o arquivo que o usuário escolher | o fundo, do começo ao fim |

**Os pops não têm sample nenhum.** Cada um é uma senoide que decai, com um
harmônico (a quinta) e 4 ms de 3,2 kHz no ataque — é o ataque que o ouvido lê
como "pop" e não como "bipe". Como é só matemática, não há licença para pagar
nem faixa para creditar. A largada é grave e curta, a parada é aguda e curtinha,
e a chegada é o único momento que pode celebrar: duas notas, a segunda uma quinta
acima, mais longa.

**Quando cada pop cai** vem do mesmo relógio do desenho: as passagens são
guardadas em progresso do percurso (0..1), e o pop usa o par `voo`/`percurso` da
timeline — então ele soa **junto** com o pino, não antes nem depois. Durante o
voo de abertura não há pop: nada aconteceu ainda. Dois eventos a menos de 0,12 s
um do outro viram um só (senão o volume dobra e o ouvido não distingue "dois" de
"um mais alto").

**A música é o arquivo do usuário.** O app não distribui faixa nenhuma: ele
decodifica o MP3/M4A/WAV/OGG escolhido (num `AudioContext` já em 48 kHz, então o
navegador reamostra na leitura), ajusta ao tamanho do vídeo e mistura por baixo
dos pops. Faixa **curta repete** com uma emenda de 120 ms em que a cauda de uma
volta se soma à cabeça da seguinte com pesos que dão 1 — sem isso, cada volta
começaria com um estalo. Faixa **longa é cortada**, com 0,5 s de entrada e 1,2 s
de saída (o vídeo termina na cartela; a música não pode acabar no meio de um
compasso). O arquivo de música **não fica salvo**: são megabytes, e o
`localStorage` tem ~5 MB para o site inteiro. Só o volume (padrão 55%) vai para
as preferências — e junto no link compartilhado, com o interruptor dos pops.

**Como o som entra no arquivo.** O áudio é codificado **antes** do primeiro
quadro de vídeo, porque o muxer precisa declarar a faixa no cabeçalho — uma faixa
anunciada e vazia quebra o arquivo. AAC-LC (`mp4a.40.2`) no MP4, Opus (`A_OPUS`)
no WebM, os dois a 48 kHz; os blocos são de **1024** amostras no AAC e **960** no
Opus (20 ms), e o último é completado com silêncio em vez de sair torto. Na hora
de escrever, os blocos entram **intercalados** com os quadros: 14 s de áudio na
frente obrigariam o tocador a pular o arquivo inteiro para começar a imagem.

Na **gravação em tempo real** o som entra como faixa da `MediaStream`
(`MediaStreamAudioDestinationNode`), e o `mimeType` passa a declarar o codec de
áudio — sem isso o navegador ignora a faixa em silêncio.

**Se o navegador não souber codificar áudio**, o vídeo sai mudo — e o painel do
fim diz isso com todas as letras. O mesmo vale se o muxer recusar a faixa: perder
o som é ruim, perder o vídeo é pior.

### O que faz o mapa fluir (medido nos vídeos do usuário)

O usuário comparou três exportações e disse que uma delas "flui melhor o mapa e o trajeto". Medindo
os três arquivos com a mesma janela do quadro (fundo do mapa, sem HUD nem pino), o que separa o que
flui do que trava **não é o tamanho do passo** — nos três o mapa anda ~7 px por quadro:

| arquivo | quadros por segundo | quadros no intervalo típico | veredito |
|---|---|---|---|
| "Meia Maratona de Sorocaba" (o que flui) | ~53 | **93%** | ✔ |
| rotacast 18-27 | 30 | 78% | ✘ |
| rotacast 12-16 | 24 | 46% | ✘ |

É a **regularidade** da cadência: quando a tela engasga, o quadro seguinte chega tarde, e o olho lê
como travada — mesmo com a velocidade média certa.

O limite disso está medido no arquivo seguinte que o usuário mandou: **60 quadros por segundo no
tempo real, com o painel dizendo "Cadência: 63% dos quadros no mesmo intervalo (16,7 ms)"**. A 60 cada
quadro tem **16,7 ms** para desenhar o mapa inteiro e entregá-lo ao gravador; quando não cabe, o quadro
seguinte sai 8, 16 ou 25 ms depois. A 30 sobram 33 ms. Então:

1. **O tempo real grava no máximo a 30** (`TEMPO_REAL_MAX_FPS` / `fpsDoTempoReal`), mesmo com 60 pedido
   — e 60 continua sendo possível na **exportação rápida (⚡)**, que não espera o relógio da tela: ela
   desenha cada quadro e escreve o tempo exato.
2. **O padrão segue 60** (`fps` em `DEFAULT_SETTINGS`), porque no ⚡ (o caminho recomendado) é o que
   flui. Sem o ⚡, o app cai para 30 em vez de produzir quadros atrasados.
3. **A gravação em tempo real mede e mostra a própria cadência** (`medirCadencia`, no painel do fim):
   a porcentagem de quadros no intervalo típico e, quando algum sai do tempo, **quanto** ele sai. A
   tolerância tem piso de 1 ms (`PISO_TOLERANCIA_MS`) — a ±5% em 60 fps seriam 0,8 ms, menos que o
   tremor normal do navegador, e a régua ficaria mais dura a 60 do que a 30.
4. **O ⚡ avisa antes de gravar.** `motivoRapidoIndisponivel` diz *por que* ele não roda (sem WebCodecs,
   formato/tamanho recusado), e o aviso aparece junto do interruptor e na janela de gravação — antes o
   app caía para o tempo real **em silêncio**.
5. **Os blocos do mapa têm novas tentativas e são contados antes de gravar** (`SceneRenderer.preparar`).
   Um bloco recusado pelos servidores gratuitos ficava faltando em silêncio, e o usuário só descobria no
   fim ("233 blocos saíram do nível anterior"). Agora são três tentativas com espera crescente, e o que
   sobrar aparece no aviso antes do primeiro quadro.

### Importar GPX: os motivos de não funcionar no celular

1. **O seletor de arquivo era aberto por `input.click()` num input `display: none`.** No Safari
   (iPhone/iPad) isso simplesmente **não abre nada**: o usuário toca em "Importar" e não acontece
   nada — nem arquivo escolhido, nem mensagem. Agora quem abre o seletor é o **rótulo** (`<label>`)
   envolvendo o input, que fica escondido com `sr-only` (recortado, não `display: none`). É o
   navegador quem abre, sem JavaScript no meio.
2. **O `accept` filtrava o seletor — e filtro é "escolhi e não abre".** No Android o seletor filtra
   por **tipo MIME**, e um `.gpx` baixado do Strava chega como `application/octet-stream`,
   `text/plain` ou até com o nome **sem extensão** (`StravaGPX`). Mesmo a lista larga deixava arquivo
   apagado em alguns aparelhos, e arquivo apagado não abre por mais que se toque nele. O input agora
   **não tem filtro nenhum**; quem valida o conteúdo é o `parseGpx`, que recusa o que não é GPX com
   um recado claro.
3. **Limpar o `value` do input no meio do `change` invalida o `File` no Safari do iPhone.** Escolher
   o arquivo "não abria" por causa disso; o campo agora é limpo no fim da fila (`setTimeout`), depois
   que o `File` já foi lido.
4. **Leitura que nunca termina não ficava em silêncio.** Quando o provedor de conteúdo da nuvem
   entrega o `File` e não devolve os bytes, o `FileReader` fica parado sem `load` nem `error`. Agora
   há um prazo (`PRAZO_LEITURA_MS`, 30 s) que desiste **com recado**, e o painel mostra
   *Lendo "arquivo.gpx" (456 KB)…* no instante em que o arquivo é escolhido — se algo falhar, o erro
   toma o lugar dessa linha.
5. **A leitura não depende de `file.text()`.** Onde ele falta (WebView antigo de Android, iOS até 13,
   navegador embutido de aplicativo), `lerTextoDoArquivo` usa o `FileReader` como reserva. Antes, esse
   caso caía no aviso genérico *"Não foi possível ler o arquivo. Verifique se é um GPX válido."* —
   culpando um arquivo que estava perfeito. Agora cada falha tem o seu recado: arquivo de 0 byte
   (comum ao escolher direto da nuvem) diz para salvar no aparelho, e falta de leitor fala do
   navegador.

O teste de regressão usa o GPX real do usuário (5.704 pontos) num `File` **sem** `.text()` — que é
exatamente o cenário do `jsdom` e o dos navegadores que falhavam.

### Serviços gratuitos usados

| Serviço | Para quê | Limite |
|---|---|---|
| OpenStreetMap, CyclOSM, OpenTopoMap, Esri | Mapas | Uso moderado (política de *fair use*) |
| Esri World Hillshade (USGS) | Sombreado do relevo | Mesma origem dos mapas Esri |
| OSRM (`routing.openstreetmap.de`) | Traçado das rotas e encaixe nas ruas | Demonstração pública |
| Nominatim | Busca de cidades | ~1 requisição por segundo |

Nenhum exige cadastro ou chave. São mantidos por projetos comunitários e adequados a **uso
pessoal ou de baixo tráfego**. Se o site virar algo com muitos acessos por dia, o correto é
migrar para um provedor com plano próprio (MapTiler, Stadia Maps, Geoapify, Mapbox) — basta
trocar as URLs em `src/lib/tiles.ts` e `src/lib/routing.ts`.

### Créditos obrigatórios

As licenças (ODbL, CC-BY-SA) exigem atribuição. O app **já desenha o crédito automaticamente**
no canto do mapa e dentro do vídeo exportado — não remova. Com o relevo ligado, o crédito cita as
duas fontes: a do mapa e a do sombreado (`© OpenStreetMap · Esri Hillshade`).

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

Nos últimos segundos do vídeo pode aparecer um resumo do percurso:

```
      49 km          +1.676 m        3 h 19 min
     DISTÂNCIA        ELEVAÇÃO          TEMPO
              13 de outubro de 2026
```

**Campo em branco usa o número do arquivo**; o que você escrever manda por
cima. O botão **"↓ usar os números do arquivo"** copia tudo de uma vez, para
não ter que digitar olhando o Strava.

| | |
|---|---|
| **Distância, elevação, tempo** | em branco, o que o arquivo mediu (o tempo só com `<time>`) |
| **Linha de baixo** | o que você escrever; vazia, mostra a data do percurso |
| **Arquivo sem os dados** | aquela linha não aparece — nada é inventado |
| **Texto grande** | o corpo da letra encolhe antes de o excesso virar "…" — nunca vaza da tela |

Por que digitável **e** automático: uma rota desenhada à mão não tem altitude
nem hora para medir, e às vezes o número que interessa é o do relógio de quem
pedalou, não o do arquivo. Com o arquivo preenchendo o que ficou em branco, o
interruptor ligado basta para a cartela existir — e quem quiser outro número é
só escrever por cima.

#### A distância medida do arquivo (e o ritmo)

Somar a distância ponto a ponto **sempre infla**: o vaivém do GPS faz o caminho
parecer mais longo. Medido num arquivo real de prova de rua (5.704 pontos, um a
cada 3,6 m): somando cru dá **21,717 km**, e o Strava marca **21,370**. Como o
ritmo é tempo ÷ distância, o HUD de 1h47 saía **4:58** onde o certo era **5:02** —
e o erro era todo da régua, não do relógio (esse arquivo nem tem `<time>`; o
tempo que o HUD usa é o que está escrito na cartela).

A régua é uma **média móvel de ±50 m de caminho**, em duas passadas, com três
cuidados, os três aprendidos medindo:

1. **a janela é medida em metros**, não em quantidade de pontos — o arquivo de
   1 Hz e o de 10 Hz do mesmo percurso medem o mesmo (0,002% de diferença);
2. **ponto de curva fechada fica exatamente onde está** — mais de 30° de giro num
   trecho de 40 m é esquina, não ruído. Era esse o defeito do limiar antigo de
   50°: a esquina arredondada de raio 25 m dá 46° no meio (protegida) e só 20-40°
   na entrada e na saída, e a média entrava justamente ali. Medido numa volta de
   quadra limpa, a régua antiga comia 0,8% de distância;
3. **a janela não atravessa esses pontos** — perto de uma esquina, a média só
   enxerga o lado do caminho em que o ponto está. Sem isso, a média pegava pontos
   dos dois lados da curva e o traçado "estourava" ali: numa rua de cidade limpa
   a janela de 32 m inventava **+2,5%** de distância, sem uma curva a mais para
   justificar.

O giro é medido de **40 m antes até 40 m depois**, e não entre pontos vizinhos:
com ruído, um ponto jogado 3 m para o lado "vira" 50° sozinho, e aí o filtro
preserva tudo e não filtra nada (foi o primeiro defeito que apareceu, medindo). O
span também separa vaivém de curva quando os dois têm o mesmo tamanho aparente: o
erro do rumo **cai** com a distância, o giro de uma curva de verdade **não**. Numa
reta densa com ruído branco de ±2,5 m, o giro medido tem mediana de 23° num span
de 20 m e de 13° num span de 40 m.

Reta de 21,37 km com um ponto a cada 5 m (ruído correlacionado, que é o do GPS de
verdade):

| ruído do GPS | somando cru | com o filtro |
|---|---|---|
| ±1,5 m | +1,4% | +0,01% |
| ±2,0 m | +2,5% | +0,02% |
| ±2,5 m | +3,9% | +0,03% |
| ±3,0 m | +5,7% | +0,07% |

E a geometria de verdade não é comida:

| percurso | somando cru | com o filtro |
|---|---|---|
| reta limpa | 0% | **0,000%** |
| rua de cidade com esquina arredondada de raio 25 m (limpa) | 0% | **0,000%** |
| meia-volta de serra com 20 m de raio (limpa) | 0% | **0,000%** |
| volta de quadra de 0,9 km (limpa) | 0% | −0,11% |
| percurso de 34,7 km com esquinas e curvas de raio 150 m | 0% | −0,25% |
| a mesma rua de cidade com ruído de ±2,5 m | +4,1% | +1,3% |
| serpentina longa (30 m de amplitude a cada 400 m) | 0% | −1,5% |

A última linha é o preço da janela larga, e está aí de propósito: com a janela
antiga de ±8 m o erro dessa serpentina era −0,04%, mas o vaivém do GPS ficava no
meio — 0,76% de distância no arquivo real. Numa estrada sinuosa dessas, 1,5% uma
vez a menos vale menos do que 0,76% em **todo** percurso de rua. Esquina de rua,
curva de serra, rotatória e volta de quadra continuam inteiras.

Antes e depois, nos mesmos casos (o arquivo real é o que manda):

| caso | régua antiga (±8 m, 50°, 20 m) | régua atual (±50 m, 30°, 40 m) |
|---|---|---|
| **arquivo real (o Strava marca 21,370 km)** | 21,531 km (**+0,76%**) | **21,387 km (+0,08%)** |
| percurso de 34,7 km com curvas (limpo) | −0,40% | −0,25% |
| o mesmo com ruído | −0,27% | −0,08% |
| volta de quadra de 0,9 km (limpa) | −0,76% | −0,11% |
| reta densa com ruído correlacionado de ±2,5 m | +1,00% | −0,06% |
| reta densa com ruído branco de ±2,5 m | +36,0% | +1,4% |

Numa reta limpa o filtro é inofensivo por construção: a média de pontos alinhados
cai na própria reta. O **desenho** continua sendo o arquivo, ponto a ponto; quem
passa pelo filtro é só a medida — a distância do HUD, o ritmo, as marcas de km e
o km dos avisos. A cartela continua sendo **só exibição**: nada no cálculo lê o
que você digita nela.

A **elevação** vem do `<ele>` e o **tempo** do `<time>`, campos que o Strava e o
Garmin gravam em todo ponto e que o app passou a ler (antes eram ignorados).
Ela passa por um corte de ruído, porque o altímetro oscila a cada leitura e somar
tudo cru inventa subida — numa pedalada de teste com ruído de ±1,5 m:

| | elevação |
|---|---|
| somando tudo cru | 3.538 m ❌ |
| com o corte (o que o app sugere) | **1.676 m** |
| valor real da simulação | 1.684 m |

O corte é pelo **balanço** do erro: uma oscilação de ±1,5 m anda 3 m entre
leituras, então o limiar de 4 m fica acima disso e o vaivém não conta. A
referência só anda quando a variação passa do limiar, o que mantém o erro do
total abaixo do próprio limiar — em vez de acumular o erro das pontas, como
faria um suavizado.

### Avatar no personagem

O selo que anda pelo mapa pode mostrar uma **foto** no lugar do emoji:

| | |
|---|---|
| **Sem foto** | o emoji do personagem escolhido (carro, bike, cachorro…) |
| **Com foto** | a foto, recortada em círculo dentro do mesmo selo |
| **Seta e pulso** | continuam iguais: a seta diz o rumo, o anel bate no passo |

A foto é reduzida e guardada como as outras (640 px, JPEG) e passa pela mesma
peneira do `localStorage`; um endereço de imagem na internet é descartado — o
avatar tem de ser um arquivo escolhido aqui. O emoji gira com o rumo (o barco
aponta para onde vai); a foto **não** gira, para a cara não sair de cabeça para
baixo. Enquanto a foto não chega, o emoji continua no lugar: o personagem nunca
some do vídeo.

### Travessias longas (intercontinental)

Dá para simular uma travessia entre continentes:

1. **Tipo de deslocamento → Livre (✏️)**: linha reta entre os pontos. O roteador
   de ruas não cruza oceano — e nem deveria.
2. Clique a partida e a chegada (por exemplo, São Paulo e Lisboa), escolha o
   personagem (o ✈️ combina) e a duração.

O que acontecia antes: a conta de blocos estourava, a exportação era recusada com
"demais para os servidores gratuitos, mesmo no zoom mínimo" e a única saída era a
câmera "Rota toda". O piso do zoom de acompanhamento era **11** — escala de
cidade, impraticável para milhares de km.

Agora o piso é **3** (escala de continente), e ao gravar o app escolhe a câmera
que cabe:

| rota (720×1280, terceira pessoa) | zoom que cabe | blocos |
|---|---|---|
| 1.000 km | 12 | ~1.390 |
| 3.000 km | 10 | ~1.370 |
| 7.900 km (São Paulo → Lisboa) | 9 | ~1.400 |
| 12.000 km ou mais | 7 | ~1.400 |

Quando o ajuste acontece, a janela de gravação diz em que zoom o vídeo saiu — e a
câmera do painel **não** é alterada: o ajuste vale para aquela gravação. Se nem no
zoom mínimo couber (rota absurda ou orçamento apertado), o vídeo sai na "Rota
toda", também avisado.

### A linha paralela das travessias

Numa travessia apareciam **duas linhas** quase verticais, uma ao lado da outra, e o
personagem andava pela da direita — a que não era a rota.

Eram dois erros que só se somem em trecho de cidade:

1. **O personagem saía da rota.** A posição entre dois pontos era interpolada em
   latitude/longitude, mas o mapa desenha a rota como **reta na projeção de
   Mercator**. Em 2 km a diferença é submilimétrica; em 12.000 km ela chega a
   **58 px** no meio do percurso. Agora a interpolação é feita na mesma projeção
   do desenho (`posicaoNoSegmento`), com as pontas exatas e a longitude pelo
   caminho mais curto — o que também resolve rotas que cruzam o antimeridiano.
2. **O rastro ia até o fim do segmento.** Ele terminava no personagem, mas a cor do
   percorrido cobria *todo* o segmento atual antes de voltar — pintando o caminho
   que ainda faltava. Numa rota de cidade são metros; num traçado de poucos pontos
   é o oceano inteiro. Agora o rastro para no começo do segmento e fecha no
   personagem.

O teste que guarda isso mede o desvio do personagem até a reta desenhada (abaixo
de **0,5 px** numa travessia de 12.000 km) e confere que nenhum ponto do rastro
passa da posição do personagem.

E há o lado oposto: o rastro precisa **existir**. Ele é desenhado pelo caminho até
o personagem, e o corte de tela devolve *segmentos* — num traçado de dois pontos
não há nenhum segmento completo na tela, a lista saía vazia e o traço não era
desenhado. Numa rota de cidade isso dura um quadro, então ninguém notava; numa
travessia o vídeo inteiro saía sem o percurso preenchido. Agora o caminho sempre
tem uma âncora (o começo do trecho atual) para ligar ao personagem.

### Mapa em miniatura

No canto de cima à esquerda, **abaixo do título**, o vídeo pode mostrar a rota
inteira em miniatura:

```
 ┌──────────────────┐
 │  ●──╮            │   a rota toda, apagada
 │     ╰──╮  ╭─╮    │   o percorrido, na cor do app
 │  ◎─────╯  ╰─╯    │   ◎ o personagem agora
 │            ●     │   ● partida · ● chegada
 └──────────────────┘
```

Ele responde a uma pergunta que a câmera de terceira pessoa não responde: lá só
se vê alguns metros à frente, e não se sabe **onde no percurso** o personagem
está.

**É só o contorno, sem mapa no fundo** — e sem bloco nenhum para baixar. A
primeira versão desenhava o mapa em miniatura ali dentro; ficou pesado e
poluído, e o pedido foi o oposto: o que interessa é a forma do percurso e onde
o personagem está nele. De quebra, o aquecimento não pede nada a mais nem há
requisição por quadro: são poucas linhas e três círculos.

O tamanho é proporcional ao menor lado do quadro, então ocupa a mesma fração da
tela no 16:9 e no 9:16. **Desligado** no interruptor "Mapa em miniatura", nada
aparece no canto.

### Perfil de elevação no vídeo

A faixa no rodapé com a linha do relevo — a resposta ao "o que falta no vídeo do
Strava": eles mostram o traçado visto de cima, não a **dureza** do caminho.

- a linha se **enche junto com o personagem** (o trecho percorrido vem
  preenchido na cor do app), então em qualquer instante dá para ler "estou a 60%
  do percurso, a 312 m, e ainda vem a subida";
- o **marcador** mostra a altitude do momento, ao lado do ponto (acima ou abaixo,
  conforme o espaço — a primeira versão escrevia por cima do "D+");
- a **maior subida** vem marcada com uma faixa e a inclinação média dela
  (`subida 8,1%`), junto do D+ à direita; a altitude máxima fica à esquerda;
- **só aparece quando o traçado tem altitude** e o relevo passa de **3 m** —
  rota plana não ganha um retângulo decorativo. Sem `<ele>` no arquivo, a faixa
  simplesmente não existe (não há linha reta inventada);
- **sai de cena quando a cartela final entra**, e o crédito do OpenStreetMap
  sobe para não ficar por cima do gráfico;
- a **legenda da rota colorida** mora no mesmo canto do rodapé e é desenhada
  depois da faixa: ela sobe a altura do painel (`liftExtra`), como o crédito.
  Sem isso ela cobria o começo do gráfico e o rótulo da altitude máxima — foi o
  "o gráfico está atrás da legenda de elevação";
- a faixa é a **última** do rodapé na ordem de desenho: barra de progresso,
  perfil e, acima dos dois, legenda e crédito.

O perfil é calculado **uma vez por traçado** e cacheado no renderizador: são 160
colunas em vez de 5.700 pontos, e o desenho de cada quadro só lê o resultado —
varrer o arquivo inteiro 60 vezes por segundo derrubaria a cadência.

Os números: `trailProfile` mede a linha pela distância **do desenho** (a mesma
que o personagem percorre, para gráfico e mapa contarem a mesma história), e o
D+ usa o mesmo filtro de ruído do resumo (variação abaixo de 4 m não conta).

### HUD no vídeo

Um **anel** abaixo do título (não no canto de cima: o título pinta uma faixa de
ponta a ponta, e o anel brigava com ela):

```
              ╭─────────╮
           ╭──┤   24    ├──╮    o arco = andamento do percurso
           │  │  km/h   │  │    o centro = velocidade
           ╰──┤         ├──╯
              ╰─────────╯
            18,4 km · 1:12:30   distância percorrida · tempo
```

**A distância mora num lugar só.** O canto superior direito do título chegou a
mostrar a distância percorrida também — `6.00 km`, com ponto decimal —, enquanto
a faixa sob o anel mostrava a mesma distância em `6,00 km`: dois formatos do
mesmo número, um acima e outro abaixo do anel (o usuário viu: *"tanto em cima
quanto em baixo dele, tem a marcação de km"*). O selo da distância saiu. Naquele
canto fica só o **contador de paradas** (quando ligado), e o número do percurso
fica na faixa — com o relógio ao lado quando há relógio.

**A velocidade e o relógio vêm, nesta ordem:**

| situação | velocidade | relógio |
|---|---|---|
| arquivo com `<time>` | real, daquele instante | tempo real da pedalada |
| sem hora, com **tempo na cartela** | `média` (distância ÷ tempo escrito), com o rótulo | conta até o tempo escrito |
| sem hora e sem tempo | **prévia**: inclinação do trecho ou quanto falta | **nenhum** |

**A pé (Corrida e Caminhada), o centro do anel mostra o ritmo**, não a
velocidade — é a unidade de quem vai a pé, e é o número que corredor olha:

```
              ╭─────────╮
           ╭──┤  5:24   ├──╮    o arco = andamento do percurso
           │  │ min/km  │  │    o centro = ritmo médio do percurso
           ╰──┤  média  ├──╯
              ╰─────────╯
            5,0 km · 27:00
```

O ritmo é **sempre a média do percurso** (tempo total ÷ distância), e não o
ritmo do instante: num clipe de 14 s o ritmo instantâneo não quer dizer nada. O
tempo sai da mesma fonte honesta do relógio — hora do arquivo, ou o tempo
escrito na cartela. Sem os dois, um traço com o rótulo `sem arquivo`; num
percurso com menos de 50 m (ritmo sobre 30 m é ruído de GPS), um traço com
`percurso curto`. A atividade escolhida no painel viaja no link.

A terceira linha existe porque a reserva antiga era o tempo do vídeo, e isso
confundia: o HUD parecia mostrar o tempo da pedalada e mostrava a duração do
clipe — que a barra de progresso já representa. Número que não existe, o HUD não
mostra.

O tempo digitado na cartela é lido no formato que se escreve naturalmente:
`3 h 19 min`, `199 min`, `1h30`, `45 s`, `1:30`. O que não der para ler é
tratado como "sem tempo".

E o relógio usa **relógio de atividade** (`1:39:30` acima de uma hora): em
`mm:ss`, uma pedalada de 3 h 19 min apareceria como `199:00` — minutos e
segundos sem dizer que são minutos.

**A velocidade passa por uma janela de 20 s**, e o deslocamento usado é a
**linha reta entre as pontas da janela**. As duas coisas vieram de medir:

- a leitura crua do GPS é barulhenta — dois pontos vizinhos dão picos de 80 km/h
  numa pedalada de 20;
- somar a distância percorrida dentro da janela **piora** o ruído, porque um
  ponto que sai do lugar e volta conta a ida *e* a volta, dobrando o salto. A
  linha reta cancela o vaivém (que é o que o erro do GPS faz) e continua honesta
  numa estrada normal, porque 20 s é um trecho curto.

Salto acima de 120 km/h é descartado — nenhum veículo do app chega lá.

**E as horas são as do traçado desenhado, não as do arquivo cru.** O desenho é
uma redução do arquivo (teto de 12.000 pontos): um GPX de 50.000 pontos vira
10.001. Com o vetor de horas do arquivo inteiro, os índices apontavam para pontos
que não estavam na tela — medido antes da correção, o relógio lia **1:23:20** na
metade de uma pedalada de **13:53:19**, cinco vezes menos do que devia. O app
manda o vetor do traçado desenhado (mesmos pontos, mesmas horas), e o
renderizador **confere o tamanho**: se não casar, nenhum relógio é mostrado (o
anel cai na prévia de percurso, sem hora) em vez de um número errado. A rota
colorida recebeu a mesma guarda.

#### Prévia de percurso (arquivo sem horário)

Um GPX de **prova** ou de rota planejada tem posições — e quase sempre altitude —
mas não tem `<time>`. Não existe velocidade nem ritmo para mostrar, e o HUD
antigo ficava com um traço e a palavra `sem arquivo` **do primeiro ao último
quadro**, ou seja: o vídeo inteiro dizendo que falta dado. Num vídeo de prévia
("como é essa prova?"), isso é o defeito principal.

Sem relógio nenhum (nem arquivo, nem tempo escrito na cartela), o anel passa a
mostrar o que a rota **tem**:

```
              ╭─────────╮
           ╭──┤   7,5   ├──╮    o arco = andamento do percurso
           │  │  descendo│  │    o centro = inclinação do trecho
           ╰──┤    %    ├──╯
              ╰─────────╯
            3,1 de 11,1 km · 28%
```

1. **com elevação:** a inclinação do trecho, lida da **mesma série** que pinta a
   linha (`slopeSeries`/`slopeAt`) — o número nunca discorda da cor embaixo do
   personagem. O valor vai sem sinal e o sentido vai escrito (`subindo`,
   `descendo`, `plano`);
2. **sem elevação:** **quanto falta** (`restantes`, em km). Existe em qualquer
   traçado e é a pergunta de quem olha uma prévia.

Nada é inventado: continua não havendo velocidade, ritmo nem relógio. O que muda
é que o anel para de acusar falta de dado e passa a informar. No painel, o
interruptor "HUD no vídeo" avisa quando isso vale para o arquivo carregado.

O caminho contrário também vale: basta **escrever o tempo na cartela** (`3 h 19
min`) para o vídeo voltar a ter relógio e ritmo médio — aí o número é do usuário,
não do arquivo.

### Destaques do percurso (melhor parcial e maior subida)

O vídeo já mostrava o traçado, o HUD e o perfil — faltava **contar a corrida**.
Dois avisos curtos entram na tela, uma vez cada:

```
   ┌─────────────────┐        ┌─────────────────┐
   │ ★ MELHOR KM     │        │ ★ MAIOR SUBIDA  │
   │ 4:12  /km       │        │ 240  m          │
   │ km 7 de 21,1    │        │ 8,1% · km 12    │
   └─────────────────┘        └─────────────────┘
```

**A melhor parcial** é o trecho mais rápido, medido com o **mesmo cronômetro do
HUD** (`elapsedAt`, que interpola a hora na distância). As fronteiras são as
**mesmas marcas de km desenhadas na linha** (`kmStep`) — cada número no mapa é
uma fronteira de parcial, e o vídeo não tem duas réguas.

**A maior subida** é a do perfil (a diferença máxima entre um vale e um cume
posterior), com os metros ganhos e a inclinação média dela.

O que impede número inventado:

| situação | resultado |
|---|---|
| arquivo sem `<time>` | **nenhuma** parcial (o tempo do vídeo daria milhares de km/h) |
| trecho com menos de 90% dos pontos com hora | aquela parcial não existe |
| menos de três parciais | não existe "a melhor" — existe "a única" |
| rota sem elevação ou desnível < 20 m | nenhuma subida em destaque |

**Onde e quando.** O aviso tem lugar **fixo** — centralizado, logo abaixo do
título (e abaixo do minimapa, quando ligado), fora da coluna do HUD. A primeira
versão ancorava o aviso no ponto do mapa onde o feito aconteceu, e no instante em
que ele fica inteiro o personagem está exatamente ali: o aviso caía **em cima do
personagem**. Como aviso, ele é um letreiro.

No tempo, ele entra 0,25 s antes do momento, fica 2,2 s e sai numa rampa de
0,35 s — tudo em **segundos de vídeo**, então um clipe de 8 s e um de 40 s
mostram o aviso pelo mesmo tanto. Dois avisos a menos de 0,9 s um do outro: só o
primeiro aparece. Mais perto que isso, a permanência de cada um é encurtada para
ceder a vez ao seguinte — eles nunca se sobrepõem.

Desligável em "🏅 Destaques do percurso" e viaja no link.

### Relevo: a luz e a sombra do terreno

Um interruptor **⛰️ Relevo (luz e sombra do terreno)** no painel do mapa põe o
sombreado do terreno (Esri/USGS, sem chave) por cima de qualquer estilo. Não é
3D: o mapa continua visto de cima, mas a serra aparece pela luz — a encosta que
pega sol fica clara, a que está virada para o outro lado fica escura.

O sombreado **não é uma segunda camada no desenho**: ele é misturado no próprio
bloco do mapa, antes de o bloco entrar no cache (`comporRelevo`). Assim a
gravação, o congelamento de blocos e o aquecimento não precisam saber que existe
uma imagem a mais — o vídeo continua pedindo "o bloco 14/5123/9876" e recebe o
mapa já sombreado.

| mapa | mistura | por quê |
|---|---|---|
| Escuro | `overlay`, 70% | é o que mais mostra o relevo: sobre quase-preto, a encosta iluminada é o que desenha a serra |
| Clean / Padrão / Ciclo | `multiply`, 40% | sombra clássica; 40% é o ponto em que a encosta aparece sem lavar o mapa |
| Satélite | `soft-light`, 70% | o `overlay` puxaria o verde da mata para um tom irreal |
| Topo | — | o OpenTopoMap já traz curvas de nível e sombreado próprios |

A escolha do modo tem um motivo medido, e ele é o **cinza neutro**. O sombreado
do USGS vem em cinza: 128 é encosta plana, 255 é encosta pegando sol, 0 é
sombra. É justamente no 128 que `overlay` e `soft-light` deixam o mapa **como
estava** — só a encosta muda de brilho. As duas primeiras tentativas erraram
nisso, e as duas foram descartadas por medida, não por gosto:

| mistura | base clara (#f2ede4) | base escura (#141a22) |
|---|---|---|
| `multiply` 55% | luminância média cai de 239 para **201** — o mapa lava | 27 → 23, e o relevo quase não aparece |
| `screen` 30% | 239 → 244, quase nada | 27 → **82**: a encosta iluminada estoura |
| `overlay` 70% | 239 → 243 | 27 → 34, com a serra legível |

Ou seja: `multiply` escurece até o plano e `screen` acende até o plano — os dois
borram a informação. `overlay`/`soft-light` são os que sozinhos deixam o plano
intacto e mudam só o que é encosta.

**O custo é uma requisição a mais por bloco** (o mapa e a sombra do mesmo
pedaço) — mas **não o dobro**: até o zoom 16 cada bloco do mapa tem a sua
sombra, e acima disso quatro blocos do 18 dividem **uma** do 16.

**Cada servidor tem o seu teto**: o mapa continua em 1.400 blocos, e o
sombreado — que vem de outro host — responde pelo mesmo 1.400 (`cabeNoTeto`).
Somar os dois contra um teto só foi o segundo erro, e o mais caro: abaixo do
zoom 16 a sombra é 1:1, então *baixar* o zoom quase não diminuía a soma. Uma
rota de **16 km no zoom 17** pedia 1.395 blocos de mapa (dentro do teto) + 229
de relevo, e o app despencava para o **zoom 12** para fazer a soma caber em
1.400. Hoje ela fica no 17.

**A folga de 10% (`FOLGA_DO_TETO`)**: o 1.400 é uma conta de vista de cima; a
terceira pessoa com giro e inclinação cobre mais chão no mesmo zoom. A mesma
rota de 16 km no 17 pedia 1.381 de cima e **1.490** com giro + inclinação — 8%
mais. Derrubar o zoom por causa disso era o mesmo defeito com outra roupa, então
o teto de cada servidor vale até **1.540**; o painel diz quando o número passou
do 1.400 mas está na folga.

O primeiro erro tinha sido dividir o teto por 2 (`budgetDeBlocos`) e tratar todo
bloco como dois pedidos: 10 km no zoom 17 — 831 de mapa + 394 de sombra — saíam
no **16,5**. O contador do painel mostra as duas contas separadas, e é isso que
o vídeo usa.

Acima do zoom 16 o serviço não tem bloco próprio: o do 16 é recortado no pedaço
que interessa (`hillshadeBloco`) em vez de pedir um bloco que não existe. Se o
sombreado não chegar (servidor fora do ar, bloqueio de rede), o bloco sai **sem**
o relevo — perder a sombra é ruim, perder o mapa no meio do vídeo não pode.

O mapa que antes se chamava "Relevo" (OpenTopoMap) agora se chama **Topo**: o
nome "Relevo" ficou para o sombreado.

### Rota colorida (velocidade ou inclinação)

Tudo num mesmo interruptor de três posições: **Sólida** (como sempre foi),
**Velocidade** e **Inclinação**. As duas últimas são facultativas e dependem do
arquivo — sem `<ele>` não há inclinação, sem `<time>` não há velocidade, e os
pontos sem o dado saem em **cinza** (com o aviso "sem dado" na legenda) em vez
de uma cor inventada.

| modo | escala | o que lê |
|---|---|---|
| Inclinação | fixa: −6% · −4% · −2% · −1% · +1% · +2% · +4% · +6% | `<ele>` sobre a distância |
| Velocidade | **do percurso**: percentis 5 e 95 das velocidades medidas | `<time>`, com a mesma janela de 20 s do HUD |

A escala da inclinação é fixa de propósito (a mesma cor significa a mesma coisa
em qualquer lugar do mundo, e o meio da escala é a cor neutra, então um percurso
plano aparece plano); a da velocidade é do percurso, porque 30 km/h é rápido de
bicicleta e devagar de carro.

**Três cuidados que vieram de medir:**

- **A linha não é repintada ponto a ponto.** Oito faixas de cor = **oito
  passadas** com um único `stroke()` cada, mais uma para o cinza. Um traço por
  segmento seriam doze mil traços por quadro, e o vídeo é desenhado 30 vezes por
  segundo. Os pontos visíveis são projetados **uma vez** por quadro e as passadas
  só leem índices (vetores reaproveitados, sem alocar).
- **A altitude do GPS é barulhenta.** Um degrau de 4 m entre dois pontos
  distantes 10 m é 40% de rampa que não existe. A altitude passa por uma média
  móvel **por distância** (±40 m) antes de virar inclinação, e a rampa é medida
  numa janela de 200 m. Medido no perfil sintético do teste de ponta a ponta: o
  erro contra a rampa verdadeira ficou em **0,10 ponto percentual**, e uma
  pedalada plana com ±2 m de barulho quase não passa de ±2%.
- **Um ponto fora do lugar não pinta o percurso.** Com a janela de 200 m, um
  pico isolado de 60 m afeta menos de 5% dos pontos.

Embaixo, no canto, sai a **legenda**: o nome da escala, as faixas de cor e os
dois extremos escritos. Sem ela, cor não significa nada — a faixa não diz se são
12 ou 40 km/h.

### Marcas de km

Um ponto no traçado e, ao lado, quantos quilômetros. O passo acompanha o
tamanho da rota (1, 2, 5, 10, 20, 25, 50 ou 100 km), limitado a **12 marcas** —
numa travessia de 400 km, uma marca por km seriam 400 números empilhados.

- **toda** marca leva número. Cheguei a numerar só as redondas em passos grandes,
  para "não poluir", e o resultado era o oposto: numa rota de 435 km o passo
  vira 50 km e só as marcas de 250 em 250 levavam número — sete pontos mudos e um
  número na tela. Marca sem número não significa nada, e são no máximo doze
  etiquetas: não há poluição possível.

Rota de 55 km: passo 5 → 11 marcas, de 5 a 55. Rota de 3 km: passo 1 → 3 marcas.
Abaixo de 1 km não há marca nenhuma (não existe km redondo para marcar).
Rota de 435 km: passo 50 → 9 marcas, de 50 a 450, todas numeradas.

### Câmera cinematográfica

Também facultativa, e só faz sentido na câmera **Seguir** (no "Rota toda" a rota
já está inteira na tela, e o painel avisa).

- **Abertura:** o vídeo começa com a região inteira na tela — o mesmo
  enquadramento do "Rota toda" — e pousa na rota. Duração: 25% do vídeo, com
  teto de 2,6 s.
- **Paradas:** ao passar por uma parada marcada, a câmera **aproxima** 2,2
  níveis de zoom **e vai até o ícone do ponto** — o ícone (com a foto e o nome)
  termina o movimento no centro do quadro, em qualquer proporção de tela. O alvo
  da câmera é avaliado **0,1 s à frente** do relógio do vídeo: a câmera suaviza o
  alvo, e sem esse adiantamento o pico do zoom que aparece no vídeo caía 297 m
  **depois** do ponto (medido no GPX de 21,4 km, com 8 paradas); com ele, o pico
  cai em cima do ponto (0 m de mediana). O
  O quadro só anda **até onde o personagem continua na tela**: quanto mais
  longe o pino estiver da linha, menos o quadro se desloca e menor é o ganho de
  zoom (`boostQueCabe` decide o ganho, `pesoQueCabe` decide o deslocamento; a
  parada na linha continua com o ganho cheio). No arquivo de exemplo que o
  usuário mandou — uma parada com o pino a poucas dezenas de metros da linha —
  o marcador do personagem saía do quadro por 1,46 s no meio do zoom e voltava,
  e era isso o *"está até perdendo o personagem do trajeto"*. Medido numa parada
  a 440 m da linha em 720×1280: o selo do pino chega a **15,8 px** do centro no
  quadro de cima e a **144 px** na terceira pessoa (onde o personagem fica a 68%
  da altura, com menos espaço embaixo), o personagem anda no máximo **320 px** do
  lugar dele e **nenhum quadro** o deixa fora — sem o limite, o pino a 440 m
  ficaria a 568 px e o personagem sairia pela borda. O
  caminho **não para**: não há freada, o personagem anda o tempo todo no mesmo
  passo e a duração do vídeo não muda. A janela do zoom acompanha o percurso
  (~1,6 s de cada lado) e encolhe quando há muitas paradas, de modo que uma
  parada vizinha não recebe o zoom da outra: com 3 paradas a janela fica
  praticamente a de antes, com 40 ela cai para ~0,9% da rota em vez de o zoom
  ficar ligado a viagem inteira. Vale para todas as **passagens** (uma parada
  visitada duas vezes recebe o zoom duas vezes). A barra do tempo mostra o
  relógio do vídeo e as bolinhas das paradas marcam a passagem, então clicar
  numa delas leva ao lugar certo.

O alvo da câmera virou uma **função pura** (`camera.ts`) — antes morava dentro do
`render`, misturado com a suavização, e não tinha como ser testado. Durante a
abertura a câmera vai colada no alvo (o alvo já é a animação pronta; suavizar de
novo só atrasaria o pouso).

**A abertura entra na conta dos blocos de mapa** (`tilesForAnimation`): a vista
larga da região e as vistas aproximadas das paradas são baixadas no aquecimento.
Sem isso o começo do vídeo sairia com o mapa vazio. A vista de cada parada é a do
**lugar** dela (o pino arrastado para fora da linha — `focoDasParadas`), e não a
do ponto da rota: era o que fazia o vídeo chegar na parada com os blocos
faltando, o mapa aparecendo aos pedaços na gravação.

**O bloco que ainda não chegou não deixa buraco**: quando a câmera muda de nível
de zoom (o da parada são 2,2 níveis de uma vez), o nível novo pode não estar no
mapa por um instante — e o que ficava no lugar era o fundo. Agora o desenho
procura o **pai** daquele bloco (até três níveis acima) e desenha o pedaço certo
dele esticado no lugar exato: em vez de um quadro vazio, aparece a imagem do
nível anterior borrada por um instante, logo substituída pela exata
(`blocoDeReserva`). Custo medido numa rota de
55 km em 1280×720: **1.124 blocos** com a abertura e as paradas ligadas, contra
1.089 só com as paradas — os dois extras juntos custam ~35 blocos, dentro do teto
de 1.400. As vistas de parada são limitadas a **oito** paradas por rota (numa
rota com cinquenta, aproximar em todas dobraria a conta sem ninguém reparar nas
do meio).

### A emenda entre as imagens do mapa

Duas correções para as **linhas escuras nas emendas** dos blocos de mapa (mais
visíveis no mapa claro e no satélite):

- **No vídeo**, cada bloco era desenhado no seu retângulo exato do mundo. Com o
  zoom quebrado (o `s` fracionário do `vistaDe`), as duas bordas de uma emenda
  caíam em coordenadas de tela quebradas e a cobertura podia somar menos de um
  pixel: o que sobrava era o fundo do mapa. Agora as bordas são presas na grade
  de pixels da tela (`retanguloDoBloco`) — um bloco e o seu vizinho calculam a
  fronteira comum com a mesma conta. Com o mapa **girado** não há grade a
  seguir, e aí a emenda é coberta por meio pixel de folga em cada lado.
- **Na pré-visualização**, o Leaflet move o "map pane" com `translate3d` em
  coordenadas quebradas — e com a câmera "Seguir" ele se move a cada quadro. A
  posição é presa na grade de pixels do **aparelho** (`emPixelInteiro`, que
  considera o `devicePixelRatio`) logo depois de cada movimento: o ajuste é
  menor que meio pixel, não acumula, e é o que faz duas imagens vizinhas
  encostarem em cima de um pixel.

Os dois casos são medidos em teste: no vídeo, as bordas desenhadas são
inteiras e dois vizinhos compartilham a mesma fronteira; a folha de blocos do
mapa girado cobre o retângulo ideal por todos os lados. Um teste de pixel
(com um bloco de cor chapada e um fundo contrastante, no laboratório) conta
**zero** pixels de fundo à mostra em sete combinações de formato e câmera.

### Passagens: quando a rota volta pelo mesmo caminho

Uma parada é um **lugar**; até esta versão ela acontecia em **um instante** (`t`).
Numa ida e volta pelo mesmo caminho isso ficava errado: a parada da metade do
percurso é passada duas vezes, e a segunda não aparecia no vídeo nem na linha do
tempo.

Agora a pergunta é feita ao contrário: em vez de "quando a parada acontece",
pergunta-se **onde a rota chega perto da parada**. A resposta são todos os trechos
em que a rota fica a menos de **40 m** do lugar — um na ida, outro na volta.

| situação | passagens |
|---|---|
| parada no meio da ida, volta pelo mesmo asfalto | **2** (ida e volta) |
| mesma ida e volta, com o GPS errando 15 m | **2** (o raio não é zero por isso) |
| parada no ponto de retorno (a rota nunca sai do raio no meio) | **1** |
| a volta por uma rua paralela, 300 m ao lado | **1** (é outro lugar) |
| parada marcada a 200 m da rota | **1**, no `t` em que foi criada (comportamento antigo) |

O raio de 40 m é o que separa "passou de novo pelo mesmo lugar" de "passou numa
rua paralela": ida e volta no mesmo asfalto ficam a poucos metros uma da outra.

O que passa a acontecer **uma vez por passagem**:

- o **círculo com a foto** (e o aviso do topo, quando não há foto) — na volta,
  aparece de novo;
- a **marca na linha do tempo**: duas marcas para a mesma parada, e cada uma
  acende na sua hora;
- a **câmera cinematográfica** acelera nas duas passagens;
- o **contador**, que passa a contar passagens ("2/3 passagens") — quando não há
  repetição, ele segue contando paradas como sempre.

Na lista lateral, a parada passada mais de uma vez ganha um selo **×2** — é ali
que você confere se o app entendeu a sua rota.

### O nome da parada entra antes da chegada

O nome da parada nascia **na passagem** — e ali já era tarde: na terceira pessoa
o pino de uma parada recém-passada fica atrás do personagem e sai da tela em
menos de um segundo. Era o relato do usuário: *"o ponto que está perto do fim
demora aparecer e, quando aparece, já está sumindo da tela"*.

Agora o nome entra **2 segundos de vídeo antes** (no máximo 22% do percurso, para
o vídeo curto não acender tudo junto), que é o único momento em que a parada
está na frente do personagem, no alto do quadro. O "pipoco" — a onda de impacto
e o crescimento do pino — continua acontecendo **na passagem**, que é o instante
de chegada: só o nome chega mais cedo.

Junto vieram duas coisas que fazem os pontos serem vistos:

- a parada que ainda vem ganha um **halo** na cor dela (e o pino subiu de 0,7
  para 0,85 de escala, com 80% de opacidade);
- o bloco do nome **desvia do personagem**, como já desviava da cartela final —
  antes, no instante da passagem, o selo do personagem era desenhado por cima e
  o nome aparecia cortado, só com a borda de fora.

### A foto também entra antes

A foto da parada só aparecia **depois** da passagem. Numa parada perto do fim,
quando ela surgia, o personagem já tinha andado e o bloco — foto, nome e pino —
quase saía pela borda do quadro.

Agora a foto entra **1,2 s de vídeo antes** da passagem (no máximo 20% do
percurso, pelo mesmo motivo do nome), que é quando a parada está na frente do
personagem, no alto da tela. A janela é a mesma de sempre em duração: o tempo
que a foto ganhou na frente é devolvido na espera (`esperaExtra`), então ela
continua os mesmos 2,6 s depois da passagem. As duas âncoras são consideradas —
a passagem mais recente e a próxima —, então numa ida e volta a foto acende em
**cada** passagem, e não só na primeira.

A conta é feita **por trecho**, e não por ponto: uma rota com um ponto a cada
100 m passa exatamente por cima da parada sem ter nenhum ponto ali, e medindo por
ponto a parada "não existiria".

### Fotos nas paradas e na cartela

Duas fotos, as duas **reduzidas a 640 px** antes de entrar no app:

- **foto da parada** — aparece em um **círculo com o anel na cor da parada**
  quando o personagem passa por ela, e vira o próprio pino no mapa (o selo do
  pino passa a mostrar a foto, com um pontinho branco indicando que há uma);
- **foto do projeto** — aparece em círculo no alto da cartela final;
- **foto da partida e da chegada** — o painel "Partida e chegada" tem o mesmo
  campo de foto das paradas; ela aparece no vídeo (círculo, na largada e na
  chegada) e no pino A/B do mapa;
- **logo da marca** — no painel da cartela, ao lado da foto do projeto; aparece
  na cartela final (ver abaixo).

**Por que reduzir.** Uma foto de celular tem 4.000 px e 4 MB. Guardada como veio,
estouraria o `localStorage` (que tem ~5 MB para o site inteiro) e desenharia uma
imagem gigante reduzida em cada um dos ~30 quadros por segundo. A versão guardada
é um JPEG de 640 px (~45 KB): suficiente para o pino, o círculo e o avatar, que
são pequenos na tela.

**A janela da foto é medida em segundos de vídeo** (2,6 s, com 0,4 s de entrada e
0,7 s de saída), e não em metros como o "pipoco" do pino. Cheguei a usar metros,
e a foto ficaria ilegível justamente nas rotas longas: 1,3 km de foto numa
travessia de 435 km são **0,04 s** de vídeo. Em segundos, a foto aparece do mesmo
jeito em qualquer rota — e a pré-visualização e a gravação continuam idênticas,
porque as duas usam o mesmo instante `t`.

**A foto da parada era uma polaroide** (quadrado branco com moldura, levemente
inclinado) e ficou estranha no vídeo: o branco chamava mais atenção do que a
própria foto, e o quadrado parecia um papel colado no mapa. Virou **círculo**,
com o anel na cor da parada e um contorno escuro fino para não sumir no mapa
claro — a mesma ideia do pino e do avatar da cartela, que já eram redondos.

**A marca do projeto: o logo na cartela.** O painel da cartela ganhou o campo
**Logo** — a mesma peneira da foto (só data URL de imagem, reduzida e dentro do
teto que protege o `localStorage`), com duas diferenças: a imagem é guardada em
**PNG** quando tem transparência (o JPEG pintaria o vazio de preto, e a marca
apareceria num retângulo escuro) e o lado maior vai a 480 px, que é mais do que
a cartela usa. O desenho depende do que já está no alto do painel:

| cartela | onde o logo fica |
|---|---|
| **com foto do projeto** | na mesma linha do avatar, à esquerda — encolhe para caber no espaço que sobra e nunca encosta no círculo |
| **sem foto** | sozinho, centralizado no alto; a altura dele entra na conta do painel, então os números descem em vez de serem cobertos |

**A placa clara** (interruptor ao lado do campo) desenha um retângulo branco atrás
do logo. É para marca escura: o painel da cartela é escuro, e um logo escuro
sumiria nele. Sem a placa, o logo é desenhado como veio.

Como as outras imagens, o logo **não vai no link compartilhado** — só o
interruptor da placa clara vai, porque é uma escolha de leitura do painel. O link
continua servindo para descrever a cena, não para carregar imagens de ninguém.

**O pino da partida e da chegada é o mesmo pino das paradas** — mesmo aro
colorido, mesmo fundo, mesmo brilho. Antes ele tinha o seu próprio desenho, mais
achatado e escuro, e o par ficava "apagado" durante o trajeto (o pedido foi
literal: "poderiam ficar igual os pontos de parada"). A letra A/B também passou a
usar a cor do lugar (verde na partida, vermelho na chegada), em vez de branca
sobre um pino escuro.

**O vídeo tem três tempos: voo → percurso → cartela.** Antes havia um só relógio
(`t` era ao mesmo tempo "quanto do vídeo passou" e "quanto do percurso foi
feito"), e disso saíam dois defeitos que o usuário viu: o personagem **corria
durante o voo de abertura** (num vídeo de 20 s já tinha andado 13% do trajeto
antes de a câmera pousar) e a **cartela final entrava em 79% do percurso**,
cobrindo o fim do trajeto. Agora a câmera sobrevoa e **pousa na partida** com o
personagem parado (`routeProgress` só sai de zero no fim do voo), o percurso
ocupa o meio do vídeo e a cartela entra quando o percurso **termina**. O percurso
fica com pelo menos 40% do vídeo: em clipe curto, voo e cartela encolhem juntos.
(`src/lib/timeline.ts`)

**O vídeo abre andando.** A curva do voo era `easeInOutCubic`: saía do repouso,
então o **primeiro quadro** — justamente o que o feed mostra parado antes do play
— era uma foto da região, e o movimento só aparecia depois. Agora a abertura usa
um Hermite cúbico com **velocidade inicial** igual à média do voo
(`f'(0)=1`, `f'(1)=0`): no primeiro quadro a câmera já andou 1,3% do voo (o zoom
muda 0,036 nível por quadro a 30 fps, contra 0,00003 antes), o meio acelera um
pouco e a chegada continua com velocidade zero — o pouso não virou corte. O
**tempo do voo não mudou**: só a distribuição dentro dele. (`openingProgress` em
`src/lib/camera.ts`)

**Nas paradas, a câmera vai até a parada.** No quadro estreito (9:16) a parada
saía pela borda: a câmera acompanhava o personagem e a parada ficava deslocada
(um zoom de aproximação só piorava, porque o quadro já é apertado). Agora, na
janela da parada (~1,6 s de percurso de cada lado, a mesma da foto), a câmera
**desloca até a parada** e volta — mais o zoom de ênfase. Medido em 9:16
(720×1280, zoom 17) no momento da passagem: o pino da parada fica a **53 px** do
centro, contra 135 px antes.

**O pino com foto mostra a foto dentro dele o trajeto inteiro.** A regra antiga
dizia que "a foto ocupa o lugar do emoji" — mas a foto grande é desenhada
**acima** do pino, e só nos segundos da largada e da chegada: no resto do vídeo o
selo ficava **oco**. Agora o miolo do pino é a foto (recortada em círculo, como o
próprio app já faz no pino do mapa), e a foto grande continua aparecendo por cima
no momento. Sem foto, o miolo é o emoji (ou a letra A/B, na cor do lugar) — nunca
vazio. Vale para os pinos de partida/chegada **e** para os das paradas: uma regra
só, e foi assim que os dois ficaram idênticos.

**O personagem não cobre a partida nem a chegada.** No primeiro quadro o
personagem está exatamente em cima da partida, e no último em cima da chegada:
desenhados antes dele, o pino, o nome e a foto ficavam escondidos atrás do
personagem. Agora os dois são desenhados **depois** dele.

**A cartela final não cobre a chegada.** A cartela é medida antes do desenho, e o
pino que ela alcançaria sobe o suficiente para ficar acima dela — subindo junto
com a entrada da cartela, sem pulo. A verificação é de **interseção de
retângulos**, e não só vertical: olhando só a vertical, um pino que estava
*abaixo* da cartela subia 314 px para "escapar" de uma cartela que não estava em
cima dele (defeito encontrado medindo, e que virou teste).

**A foto da partida e a da chegada ficam nas pontas.** A da largada já está na
tela no primeiro quadro e a da chegada continua no último — a janela das
paradas, que entram e depois saem, deixaria as duas invisíveis justamente ali,
nos quadros que abrem e fecham o vídeo.

**O recorte continua quadrado e centralizado** nas duas: uma foto deitada perde
as laterais (não vira um retângulo de altura estranha no meio do mapa) e o
assunto fica no meio. A etiqueta do nome **sobe** para dar lugar à foto em vez de
ficar por baixo dela.

**Três cuidados que vieram de medir:**

- **O desenho não espera foto.** O laço do vídeo é síncrono e roda 30 vezes por
  segundo; ele só *consulta* o cache. Foto que ainda não ficou pronta não aparece
  naquele quadro — e, principalmente, **não deixa buraco**: sem a foto pronta, a
  etiqueta fica na altura de sempre (a primeira versão subia a etiqueta mesmo sem
  foto, deixando um vazio no lugar dela).
- **A exportação espera, mas com prazo.** As fotos são decodificadas antes do
  primeiro quadro (5 s de prazo): sem esperar, a foto "pipocaria" no meio da
  gravação; sem prazo, uma foto corrompida travaria a exportação em silêncio.
- **A foto não entra no link compartilhado**, e o link **não apaga** a sua: 640 px
  viram ~70 KB de texto, e um link com isso não passa por mensageiro nenhum. Quem
  abre o link vê a mesma cena, com a foto que já tinha.
- **As fotos são carregadas por uma lista só** (`photoSources`), que junta
  cartela, paradas e partida/chegada. Montada à mão, essa lista já esqueceu as
  fotos de A e B: elas ficavam fora do cache, o desenho recebia `null` e a foto
  **nunca** aparecia no vídeo — enquanto as das paradas apareciam normalmente. É
  o tipo de defeito que só se vê com duas telas lado a lado, então o remédio é
  não ter duas listas.
- **Mexer no emoji ou no nome não apaga a foto.** O editor de partida/chegada
  remontava o local só com emoji e nome, e escrever o nome (ou tocar num atalho)
  apagava a foto escolhida, inclusive do pino no mapa. Agora toda mudança passa
  por `patchMark`, que só troca o campo pedido.

**Não há aviso no topo da tela.** O aviso que anunciava a passagem (e a chegada)
numa tarja no alto do vídeo foi **removido** — a pedido: quem anuncia o lugar é o
próprio mapa. Nas paradas é o pino com o miolo da foto (ou o emoji) mais o bloco
com a foto, o nome e o km; na partida e na chegada são os pinos A/B, com o nome
e a foto desenhados ao lado. E o bloco da parada desvia da cartela final e dos
selos A/B, então o lugar nunca fica escondido atrás de nada nem fora da moldura.

**Onde a foto fica guardada:** a do projeto vai para o `localStorage` com o resto
da cartela; a da partida/chegada vai junto dos locais; as das paradas vivem na
sessão, como as próprias paradas (que nunca foram salvas). Se uma foto não couber
na cota, o app **grava o resto e avisa** na tela — em vez de perder todos os
ajustes em silêncio, que era o que a gravação antiga fazia. Isso vale também para
os locais de partida e chegada, que antes eram gravados sem plano B nenhum.

### Rotas longas: o teto de blocos de mapa

Cada bloco de mapa é um pedido a um servidor comunitário (OSM, CyclOSM,
OpenTopoMap), e o app recusa a exportação acima de **1.400 blocos** (1.540 com a
folga da terceira pessoa). Acontece que
a câmera "Seguir" no zoom padrão (16) mostra ~2,4 km de largura — então precisa
de um bloco a cada ~1,4 km de rota. Medido, em 1280×720:

| rota (seguir, zoom 16) | blocos | |
|---|---|---|
| 50 km | 924 | ✓ |
| 75 km | 1.349 | ✓ |
| 80 km | 1.439 | ✗ recusa |
| 200 km | 3.473 | ✗ |
| 435 km (São Paulo → Curitiba) | 7.237 | ✗ |

Ou seja: **toda rota acima de ~80 km era recusada** — e a mensagem mandava
"diminuir a aproximação" sem dizer até onde. Numa rota interestadual, o zoom que
cabe é 13,5, e ninguém adivinha isso arrastando um controle.

Agora o painel mostra o número antes (**"≈ 7.237 blocos"**, em âmbar quando passa
do teto) com um botão **"Usar zoom 13,5"** que resolve com um clique, e a
mensagem de erro diz qual zoom cabe. O cálculo é local — `maxFollowZoom` faz uma
busca binária entre os zooms que o controle oferece (de 0,5 em 0,5), e cada
medição percorre a rota inteira com a mesma função que conta os blocos.

| rota | zoom sugerido | blocos |
|---|---|---|
| 435 km | 13,5 | 810 |
| 700 km | 12,5 | 666 |
| 1.966 km (São Paulo → Salvador) | 11,5 | 888 |
| 3.100 km (São Paulo → Fortaleza) | 11,5 | 1.353 |

A câmera **"Rota toda"** cabe sempre: 30 a 48 blocos em qualquer dessas rotas.
Quando nem o zoom mínimo cabe (acima de ~3.500 km), o painel diz isso e manda
para a "Rota toda", em vez de oferecer um botão que não resolveria.

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

Com a **rota colorida** ligada o desenho é o mesmo caminho, feito em nove
passadas (uma por faixa de cor) em vez de duas — e com os pontos visíveis
projetados uma única vez por quadro em vetores reaproveitados. Sem esse cuidado
seriam dezoito mil projeções por quadro num percurso longo visto de longe.

### O mapa da prévia

A pré-visualização anima o **mapa do Leaflet**, e o Leaflet pede um bloco de mapa
no instante em que ele entra na tela: com a câmera a ~3 km por segundo de vídeo
(21,4 km em 7,2 s de percurso) a imagem chegava sempre atrasada, e o mapa parecia
**travar durante o percurso**. O vídeo exportado nunca sofreu disso — antes de
gravar, o renderizador baixa todos os blocos da animação (`warmup`, com barra de
progresso). Agora a prévia faz o mesmo aquecimento ao dar play: pede, seis de
cada vez e na ordem do percurso, os blocos de `tilesForAnimation` — as mesmas
URLs que o Leaflet vai pedir, então quem responde é o cache do navegador. Em
9:16 com a terceira pessoa no zoom 15, o trajeto de 21,4 km são **430 blocos**.

E ela **espera o começo** antes de andar (pedido do usuário: *"será que é possível
entender a rota, baixar todo o mapa necessário para depois criar o vídeo"*): ao
apertar ▶ a animação fica no primeiro quadro enquanto os primeiros blocos chegam
("Preparando o mapa do começo… x %"), e o resto continua chegando durante o
percurso. A espera é limitada — `blocosEssenciais` espera **15%** da lista (com
piso de 40 blocos) e há um teto de **12 s** dentro do mapa e de 20 s no app, para
rede ruim não prender a tela. Um segundo clique no ▶ começa na hora.

A **trilha percorrida** também era remontada a cada quadro (`slice` +
`concat` de até 5.704 pontos, com um `LatLng` novo por ponto dentro do Leaflet).
Agora a lista de `LatLng` é montada uma vez por rota e reusada: o que entra por
quadro é a ponta (o personagem), e a lista é cortada quando o vídeo volta atrás.
O traçado planejado, a área de clique e a trilha ainda ganham `smoothFactor: 3`
(a tolerância de simplificação, em pixels, que o Leaflet já aplica): no GPX do
usuário o traçado desenhado cai de 262 pontos para **93** no zoom 15 e de 751
para **325** no 17.

### Quando o mapa trava

Na rodada em que o usuário viu *"Algo travou no app — Cannot read properties of
undefined (reading 'lat')"* não dava para saber **onde** — e o app inteiro ia
junto: mapa, barra do tempo, rota e o botão de gravar. Três coisas mudaram.

O que derruba o mapa não derruba mais o app. O `CameraBoundary` é uma fronteira de
erro só em volta do `MapView`: um quadro ruim do Leaflet (um ponto que chegou sem
coordenada no meio da animação) põe o aviso **no lugar do mapa**, e o resto da
tela continua funcionando — dá para pausar, mexer na linha do tempo e gravar o
vídeo, que não passa pelo Leaflet. Como o mapa recebe um `setView` por quadro, um
erro de um quadro só não pode custar a tela: quando `agora` (o instante que está
sendo desenhado) anda, a fronteira **retoma sozinha**, até **3** vezes. Depois
disso o aviso fica de pé — falha que se repete é falha de verdade — e o botão
"Tentar de novo" remonta o mapa do zero, sem recarregar a página (em pausa, quem
decide é o usuário: a fronteira não insiste sozinha).

E o aviso diz o que aconteceu. O texto da caixa (o mesmo do botão *Copiar
detalhes*) traz a mensagem do navegador, o **rastro** com a linha do arquivo, o
**caminho dos componentes** do React e, no caso do mapa, **em que ponto do
percurso** ele travou ("No ponto 42.1% do percurso") — é esse texto que aponta a
linha, e é ele que o usuário manda de volta. Sem área de transferência (origem sem
TLS, iframe) o botão avisa e o texto continua selecionável na tela.

O rastro do usuário fechou o caso: o erro vinha do `setLatLngs` da **trilha
percorrida**, quando o índice pulava à frente (arrastar a barra do tempo, um
engasgo do navegador, recomeçar a animação). A lista era cortada no ponto atual,
mas o `length` era **esticado** até o índice novo e os pontos que faltavam no meio
ficavam como **buracos** — e o Leaflet estoura ao projetar um buraco. Agora o
pedaço que falta é copiado do próprio traçado (`completarTrilha`): a trilha chega
inteira, sem buraco nenhum, e o mapa não cai.

A terceira mudança evita o problema em vez de contá-lo: nada chega ao Leaflet sem
ser um ponto de verdade. `pontoValido` (número finito, dentro da faixa do planeta
— texto de JSON não passa) é perguntado antes de cada `marker`, `polyline` e
`flyTo`, e o `buildTrack` **não deixa mais passar** ponto sem coordenada: um
`<trkpt>` cortado no fim do arquivo, uma coordenada nula da rota ou um link
compartilhado estragado viram, no máximo, um trecho a menos — em vez de derrubar o
app.

### O mapa não troca de bloco durante a gravação

O mp4 novo do usuário foi medido quadro a quadro: o tempo do arquivo está certo
(30 quadros por segundo, com menos de 0,3% de variação entre um quadro e outro),
mas a **imagem** mudava de repente em alguns quadros — e não era deslocamento: em
cada um desses saltos, nenhuma faixa do quadro andava junto com as outras. É troca
de **textura**: um bloco do mapa chegava durante a gravação e substituía o nível
anterior que estava no lugar.

Na gravação isso não pode acontecer — o vídeo é curto e o mapa já foi baixado
antes (`warmup`), mas um bloco pedido pelo enquadramento exato pode chegar no meio
do caminho. Agora, ao começar a gravar, o que entrou no primeiro quadro **fica**:
`blocoDoQuadro` congela cada bloco no nível em que foi desenhado e o mapa não
troca de imagem no meio do vídeo. O painel do fim conta quantos blocos saíram do
nível anterior ("N blocos do mapa não estavam prontos na hora…"): com zero, o
mapa saiu nítido do começo ao fim.

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
npm test           # Vitest (967 casos)
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
│  ├─ PhotoField.tsx        escolher/trocar a foto (reduz a 640 px antes de entrar)
│  ├─ SoundPanel.tsx        pops e música de fundo do vídeo
│  ├─ EndpointEditor.tsx    partida e chegada como locais marcados
│  ├─ Timeline.tsx          linha do tempo da pré-visualização
│  └─ ExportModal.tsx       gravação e download do vídeo
└─ lib/
   ├─ renderer.ts           desenha cada quadro do vídeo no canvas
   ├─ webcodecs.ts          exportação rápida (VideoEncoder + muxer)
   ├─ recorder.ts           gravação em tempo real (MediaRecorder)
   ├─ audio.ts              pops sintetizados, música repetida/cortada e a trilha (PCM)
   ├─ routing.ts            rotas OSRM por trecho, com cache
   ├─ tiles.ts              mapas gratuitos e filtros de estilo
   ├─ geo.ts                matemática geográfica, medida com filtro de GPS e projeção
   ├─ pins.ts               quando o pino vira ponto no mapa
   ├─ pois.ts               paradas do percurso
   ├─ stats.ts              distância, elevação (com corte de ruído), tempo e cartela
   ├─ hud.ts                velocidade, ritmo (min/km) e relógio do HUD
   ├─ duration.ts           lê o tempo digitado na cartela ('3 h 19 min', '199 min')
   ├─ passages.ts           quantas vezes a rota passa por cada parada (ida e volta)
   ├─ photos.ts             reduz, valida e decodifica as fotos (cache com prazo)
   ├─ EndCardPanel.tsx      campos da cartela final (com teste de digitação)
   ├─ gpx.ts                importar/exportar GPX, simplificação de traçado
   ├─ share.ts              permalink da rota (codifica/valida o #r=…)
   ├─ persist.ts            localStorage com plano B (guarda tudo menos a foto, se faltar cota)
   └─ geocode.ts            busca de cidades

public/comercial/
└─ precos.html             tabela de preços (publicada em /comercial/precos.html)

comercial/
├─ ofertas.md              textos de venda prontos (DM, orçamento, follow-up)
└─ README.md               como usar o material e por que esses preços
```

A tabela de preços fica em **`public/`** porque é o Vite que copia essa pasta
para o build: assim o link do rodapé do painel abre
`…/Mapa/comercial/precos.html` no site publicado, e não um 404. O `check:dist`
falha se ela sumir do build.
