# Tomate

![Logo](Logo%20Pomodoro.svg)

Timer Pomodoro com estatísticas de foco. Roda direto no navegador, sem instalação e sem servidor.

## Como usar

1. Dê dois cliques em `index.html` (abre no navegador padrão).
2. Escreva no que vai focar e clique em **Iniciar** (ou aperte Enter no campo).
3. Ao fim de cada período toca um sino e o app passa para a pausa seguinte.

### Girar o botão para ajustar o tempo

Arraste o mostrador em círculo, como num timer de cozinha. Ele avança de 1 em 1 minuto, com um clique
a cada minuto (se o som estiver ligado) e uma vibração curta no celular.

- **Antes de iniciar:** muda a duração daquele modo, e o valor fica salvo nos ajustes.
- **Com o período em andamento ou pausado:** muda só o tempo restante; o que você já focou continua contando.
- **Pelo teclado:** com o mostrador focado (Tab), setas mudam ±1 min e PageUp/PageDown ±5 min.

### Atalhos

| Tecla  | Ação              |
|--------|-------------------|
| Espaço | Iniciar ou pausar |
| R      | Reiniciar período |
| P      | Pular período     |

## Identidade visual

O design parte do `Logo Pomodoro.svg`: carcaça off-white, botão preto fosco e laranja de sinalização (`#FF3B00`).
O mostrador do app é o próprio logo em funcionamento: o botão gira de volta até o zero conforme o tempo passa,
numa escala de 60 minutos como a de um timer de cozinha. Com o foco de 25 min parado, a tela fica igual ao logo.

- `Logo Pomodoro.svg`: logo principal (cabeçalho e ícone de atalho).
- `favicon.svg`: versão simplificada para 16–32 px, onde as marcações do logo somem.
- Enquanto o timer roda, o ícone da aba mostra o progresso em tempo real.

Fonte: Archivo (Google Fonts), usando a largura variável: expandida na marca, condensada no visor.

## Movimento

As animações usam a biblioteca [Motion](https://motion.dev) (carregada do CDN) e cada uma responde a algo que aconteceu:

- **Abertura:** as marcações se desenham em sentido horário enquanto o botão "dá corda" até o tempo atual.
- **Reiniciar / trocar de modo:** o botão gira com mola até a nova duração.
- **Iniciar:** o botão afunda levemente, como um clique.
- **Visor:** os dígitos rolam como um contador mecânico.
- **Fim de um tomate:** o mostrador balança no zero, a marca do zero pisca e um segmento novo acende na meta.
  Quando a meta do dia é batida, os segmentos fazem uma onda.
- **Modo foco:** enquanto o foco corre, as estatísticas recuam (passar o mouse traz de volta).

Sem internet o app funciona igual, só sem animações. Quem usa "reduzir movimento" no sistema também fica sem elas.

## Onde ficam os dados

No `localStorage` do navegador, na chave `tomate.v1`. Cada navegador tem seus próprios dados;
use **Ajustes → Exportar backup** para guardar ou transferir.

## Arquivos

- `index.html`: estrutura da página
- `style.css`: visual
- `app.js`: timer, estatísticas, armazenamento e animações
