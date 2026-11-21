# Token Pirata Overlay (app de PC)

Janela separada, sempre por cima, que mostra a página `/overlay` do site.
Não lê a memória nem a tela do jogo, não se injeta no Fortnite e não manda teclas para ele.

- Clique atravessa a janela (não atrapalha o jogo).
- Atalhos globais do Windows (padrão): F7 = +1 baú, F8 = desfazer, F9 duas vezes = fim da partida,
  F10 = mostrar/ocultar, Ctrl+F10 = mover. Dá para trocar em "Configurar".
- Só aparece por cima do jogo com o Fortnite em **Tela cheia em janela** (Windowed Fullscreen).

## Gerar o .exe de novo

```bash
npm install
npm run dist     # gera dist/Token Pirata Overlay-1.0.0-win.zip
```

Esta pasta fica fora do deploy da Vercel (`.vercelignore`).
