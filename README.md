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

Nos últimos segundos do vídeo pode aparecer um resumo do percurso:

```
      49 km          +1.676 m        3 h 19 min
     DISTÂNCIA        ELEVAÇÃO          TEMPO
              13 de outubro de 2026
```

**Os números são escritos por você**, no painel — o arquivo importado só
*serve de dica*. Cada campo mostra ao lado o que o arquivo mediu, e o botão
**"↓ usar os números do arquivo"** copia tudo de uma vez, para não ter que
digitar olhando o Strava.

| | |
|---|---|
| **Distância, elevação, tempo** | digitados. Campo vazio = a linha não aparece |
| **Linha de baixo** | o que você escrever; vazia, mostra a data do percurso |
| **Sem nada escrito** | não há cartela: o vídeo termina no traçado |
| **Texto grande** | o corpo da letra encolhe antes de o excesso virar "…" — nunca vaza da tela |

Por que digitável e não automático: uma rota desenhada à mão não tem altitude
nem hora para medir, e às vezes o número que interessa é o do relógio de quem
pedalou, não o do arquivo. Escrevendo, a cartela serve para os dois casos — e
nada aparece no vídeo sem alguém ter pedido.

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

**A velocidade e o relógio vêm, nesta ordem:**

| situação | velocidade | relógio |
|---|---|---|
| arquivo com `<time>` | real, daquele instante | tempo real da pedalada |
| sem hora, com **tempo na cartela** | `média` (distância ÷ tempo escrito), com o rótulo | conta até o tempo escrito |
| sem hora e sem tempo | `—` | **nenhum** |

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
renderizador **confere o tamanho**: se não casar, o HUD mostra "sem arquivo" em
vez de um número errado. A rota colorida recebeu a mesma guarda.

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
- **Paradas:** chegando perto de uma parada marcada, a câmera **aproxima** 1,4
  nível de zoom e volta depois de passar. É zoom, não desvio: o personagem
  continua no centro. Duas paradas vizinhas não somam zoom, e a janela acompanha
  a duração do vídeo (~1,2 s de cada lado).

O alvo da câmera virou uma **função pura** (`camera.ts`) — antes morava dentro do
`render`, misturado com a suavização, e não tinha como ser testado. Durante a
abertura a câmera vai colada no alvo (o alvo já é a animação pronta; suavizar de
novo só atrasaria o pouso).

**A abertura entra na conta dos blocos de mapa** (`tilesForAnimation`): a vista
larga da região e as vistas aproximadas das paradas são baixadas no aquecimento.
Sem isso o começo do vídeo sairia com o mapa vazio. Custo medido numa rota de
55 km em 1280×720: **1.124 blocos** com a abertura e as paradas ligadas, contra
1.089 só com as paradas — os dois extras juntos custam ~35 blocos, dentro do teto
de 1.400. As vistas de parada são limitadas a **oito** paradas por rota (numa
rota com cinquenta, aproximar em todas dobraria a conta sem ninguém reparar nas
do meio).

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
  chegada) e no pino A/B do mapa.

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

**O pino da partida e da chegada é o mesmo pino das paradas** — mesmo aro
colorido, mesmo fundo, mesmo brilho. Antes ele tinha o seu próprio desenho, mais
achatado e escuro, e o par ficava "apagado" durante o trajeto (o pedido foi
literal: "poderiam ficar igual os pontos de parada"). A letra A/B também passou a
usar a cor do lugar (verde na partida, vermelho na chegada), em vez de branca
sobre um pino escuro.

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

**Quem tem foto não vira aviso no topo.** O círculo com a foto já anuncia o lugar
(e o nome dele está escrito embaixo); escrever de novo no topo seria repetir a
mesma informação. Vale para as paradas e para a partida/chegada. Uma ressalva que
importa: se a foto foi escolhida mas **não carregou**, o aviso volta a aparecer —
melhor repetir do que o lugar passar em branco.

**Onde a foto fica guardada:** a do projeto vai para o `localStorage` com o resto
da cartela; a da partida/chegada vai junto dos locais; as das paradas vivem na
sessão, como as próprias paradas (que nunca foram salvas). Se uma foto não couber
na cota, o app **grava o resto e avisa** na tela — em vez de perder todos os
ajustes em silêncio, que era o que a gravação antiga fazia. Isso vale também para
os locais de partida e chegada, que antes eram gravados sem plano B nenhum.

### Rotas longas: o teto de blocos de mapa

Cada bloco de mapa é um pedido a um servidor comunitário (OSM, CyclOSM,
OpenTopoMap), e o app recusa a exportação acima de **1.400 blocos**. Acontece que
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
npm test           # Vitest (536 casos)
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
   ├─ stats.ts              distância, elevação (com corte de ruído), tempo e cartela
   ├─ hud.ts                velocidade e relógio do HUD (com janela anti-ruído)
   ├─ duration.ts           lê o tempo digitado na cartela ('3 h 19 min', '199 min')
   ├─ passages.ts           quantas vezes a rota passa por cada parada (ida e volta)
   ├─ photos.ts             reduz, valida e decodifica as fotos (cache com prazo)
   ├─ EndCardPanel.tsx      campos da cartela final (com teste de digitação)
   ├─ gpx.ts                importar/exportar GPX, simplificação de traçado
   ├─ share.ts              permalink da rota (codifica/valida o #r=…)
   ├─ persist.ts            localStorage com plano B (guarda tudo menos a foto, se faltar cota)
   └─ geocode.ts            busca de cidades
```
