# Caça ao Token Pirata · guia do squad

Site estático (HTML + CSS + JavaScript, sem etapa de build) com mapa interativo esquemático de Crossbones Isle,
rotas para squad, estatísticas por local, chances oficiais do Pirate Shop Access, calculadora e agenda das Treasure Hours.

Projeto de fã, sem vínculo com a Epic Games.

## Estrutura

```
index.html          página
assets/style.css    estilos (tema claro e escuro automático)
assets/app.js       lógica, mapa e gráficos (usa D3)
vendor/d3.min.js    D3 v7 (local, sem CDN)
data/*.json         todos os dados — edite aqui para atualizar o site
vercel.json         cache e URLs limpas na Vercel
```

## Rodar localmente

O site carrega os dados com `fetch`, então precisa de um servidor (abrir o `index.html` direto com dois cliques não funciona):

```bash
npx serve .
# ou
python3 -m http.server 8000
```

## Publicar na Vercel

**Pela linha de comando**

```bash
npm i -g vercel
vercel          # cria o projeto (preview)
vercel --prod   # publica em produção
```

**Pelo GitHub**

1. Suba esta pasta para um repositório.
2. Em vercel.com → *Add New → Project* → importe o repositório.
3. Framework Preset: **Other**. Build Command: vazio. Output Directory: `.` (raiz).
4. Deploy. Cada `git push` publica de novo.

Também funciona sem mudanças na Netlify (arraste a pasta em app.netlify.com/drop), no GitHub Pages e no Cloudflare Pages.

## Atualizar os dados

| Arquivo | O que tem |
|---|---|
| `data/pois.json` | locais: posição no mapa (`x`, `y` de 0 a 1), baús padrão/enterrados/raros, cartazes, Sprites Fortune, chefe, notas. `null` = sem dados |
| `data/rotas.json` | rotas e passos (`poi` aponta para o `id` do local; passos fora de local usam `x`, `y`) |
| `data/odds.json` | chances oficiais por baú e multiplicador das Treasure Hours |
| `data/agenda.json` | Treasure Hours, Captain's Day, fim da temporada e prazo de ativação (horário com fuso `-03:00`) |
| `data/ritmos.json` | ritmos de baús por hora usados nos cenários (estimativas) |
| `data/marcos.json` | pontos de referência e cartazes de estrada |
| `data/chefes.json`, `data/fatos.json`, `data/fontes.json` | chefes, números da ilha e fontes |

### Ajustar as posições do mapa

As posições são aproximadas. Para deixá-las exatas:

1. No site, abra **"Usar meu print do mapa / ajustar posições"**.
2. Carregue um print do mapa do jogo (fica só no seu navegador).
3. Marque **Arrastar marcadores** e posicione cada local.
4. Clique em **Baixar posições (JSON)** e copie os `x`/`y` para `data/pois.json`.

Atenção: o print do mapa é arte da Epic. Ele não vai para o site publicado a menos que você coloque a imagem no repositório; se fizer isso, confira antes a política de conteúdo de fãs da Epic.

## Como as contas são feitas

- Chance de pelo menos um token em N baús: `1 − (1 − p)^N`, com `p = 1/137.500` (ou `p × 1,5` nas Treasure Hours).
- Cenários: horas por dia × dias restantes até 5/12; as horas de Treasure Hour restantes entram com a chance maior.
- Como o token achado por um jogador vale para todo o time na partida, os baús do squad inteiro somam.

## Contador do squad (`/contador`)

Página para os quatro marcarem cada baú aberto pelo celular e verem o total juntos, ao vivo.
É só um site: não lê nem mexe no jogo.

Arquivos: `contador.html`, `assets/contador.js`, `assets/contador.css` e a função `api/sala.js`.

Para funcionar entre aparelhos, o projeto precisa de um banco Redis (Upstash, grátis):

1. Na Vercel, abra o projeto → aba **Storage** → **Create Database** (ou **Browse Marketplace**) → **Upstash** → **Redis**.
2. Escolha o plano **Free**, a região mais perto (ex.: São Paulo, se aparecer) e conecte ao projeto.
3. Confirme em **Settings → Environment Variables** que existem `KV_REST_API_URL` e `KV_REST_API_TOKEN`
   (ou `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`).
4. Em **Deployments**, clique nos três pontinhos do último deploy → **Redeploy**.

Sem o banco, a página funciona em "modo local" (conta só no próprio aparelho).

Consumo: cada aparelho consulta a sala a cada 3 s com a página aberta (10 s quando ninguém mexe há 2 min) e
para quando a tela está em segundo plano. A resposta fica 2 s em cache na CDN, então os quatro celulares dividem
a mesma consulta. Os dados de uma sala são apagados depois de 60 dias sem uso.
