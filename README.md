# Gerador e analisador Lotofacil

Sistema local para baixar resultados historicos da Lotofacil no Lotorama e analisar combinacoes.

## Como usar

1. Abra o sistema. Ele consulta o histórico completo do Lotorama na inicialização e a cada 15 minutos enquanto o servidor estiver rodando:

```powershell
npm run dev
```

2. Acesse no navegador do computador:

```text
http://127.0.0.1:8000
```

## Usar no celular

1. Deixe o computador e o celular na mesma rede Wi-Fi.
2. Inicie o modo celular:

```powershell
npm run mobile
```

3. O terminal vai mostrar um endereco parecido com este:

```text
http://192.168.1.6:8001
```

4. Abra esse endereco no navegador do celular.

Se o celular nao abrir, o Windows pode estar bloqueando a porta `8001` no firewall. Nesse caso, permita o acesso do Node.js na rede privada.

## Instalar na tela do celular

Depois que o site estiver aberto no celular:

- Android/Chrome: toque em `Instalar` quando o botao aparecer, ou abra o menu do Chrome e toque em `Adicionar a tela inicial`.
- iPhone/Safari: toque em compartilhar e depois em `Adicionar a Tela de Inicio`.

O app tambem tem cache offline. Se a internet cair, ele tenta abrir com a ultima base carregada. A página verifica a base a cada minuto e atualiza o diário quando chegam novos resultados.

Para atualizar sem abrir o sistema:

```powershell
npm run update
```

Para atualizar, salvar no Git e enviar para o GitHub:

```powershell
npm run sync
```

Se voce perdeu o horario automatico, force manualmente com:

```powershell
npm run force
```

No modo local (`npm run dev` ou `npm run mobile`), a tela tambem tem o botao `Atualizar`, que baixa os resultados na hora e mostra a data da ultima atualizacao.

## Rodar online pelo GitHub Pages

Este projeto tambem esta preparado para GitHub Pages.

Depois de subir para um repositorio no GitHub:

1. Abra `Settings`.
2. Entre em `Pages`.
3. Em `Build and deployment`, selecione `GitHub Actions`.
4. O workflow `Publicar sistema` vai publicar o site.

O workflow tenta atualizar a base duas vezes por hora. Se a consulta ao Lotorama falhar, o sistema busca na Caixa os concursos que faltam na base local. Se as duas fontes estiverem indisponíveis, o site continua com a última base salva.

O metodo mais confiavel para atualizar automaticamente no GitHub e deixar o Windows rodar este arquivo uma vez por dia:

```text
scripts\sync-github.bat
```

Ele executa `npm run sync`, que baixa os resultados pelo seu computador, cria commit se a base mudou e envia para o GitHub.

## O que o sistema analisa

- Frequencia historica dos numeros 01 a 25.
- Atraso atual de cada numero.
- Frequencia recente, configuravel por janela de concursos.
- Pares de numeros que mais aparecem juntos.
- Distribuicao por linhas, colunas, pares/impares, baixos/altos e soma.
- Geracao de jogos ranqueados por uma heuristica estatistica.
- Backtest simples, comparando jogos sugeridos contra sorteios passados.
- Modo `1 jogo do dia`, com uma recomendação de 15 dezenas e nota mínima de 65/100. Compara as janelas de 30 e 120 concursos com o histórico completo, ajusta a coocorrência de pares e usa os últimos 12 jogos registrados para variar as dezenas.
- Simulação do jogo do dia em até 120 concursos, usando apenas dados anteriores a cada sorteio e comparando os acertos com as probabilidades exatas de uma combinação aleatória.
- Calculadora de 15 acertos para combinações distintas por concurso, com custo simulado e chance acumulada em sorteios independentes.
- Avaliação da probabilidade atribuída ao resultado completo. O modelo de frequências só orienta a recomendação quando a razão de verossimilhanças contra a distribuição uniforme atinge 20 nos sorteios acompanhados a partir do concurso 3836. A simulação histórica é informativa e fica fora dessa decisão.
- Modo `Diversificar jogos`, reduzindo repeticao entre apostas.
- Modo `Base 20 amarrada`, criando jogos dentro de uma base forte de 20 dezenas.
- Filtro anti-jogo-fraco para soma, paridade, altos/baixos, sequencias e concentracao.
- Diário local de jogos, com registro manual, conferência automática de acertos e exportação e importação de backup JSON.
- Aba `Conferir`, com resultado por concurso, comparação com os jogos do Diário e resumo de paridade, soma, dezenas de 01 a 13 e repetição do sorteio anterior.
- Simulação de combinações de 15 dezenas no histórico completo ou nos concursos registrados no Diário, com contagem por faixa de 11 a 15 acertos.
- Aba `Relatório`, com filtros por semana, mês e ano, gráficos de gastos, prêmios e saldo, acertos por faixa e valores por jogo. Usa o rateio da Caixa nos jogos premiados e permite registrar o valor efetivamente pago e recebido.

## Estrategia recomendada

Para acompanhar uma aposta simples por concurso, use `1 jogo do dia` e registre o jogo somente depois de fazê-lo. Se as dezenas jogadas forem diferentes, use o registro manual do diário.

Quando jogar mais de um jogo, use `Diversificar jogos` ou `Base 20 amarrada`, porque o sistema tenta evitar combinacoes muito parecidas entre si.

## Aviso importante

Lotofacil e um jogo aleatorio. Analise historica pode ajudar a organizar escolhas e reduzir apostas muito desequilibradas, mas nao aumenta a probabilidade matematica de uma combinacao especifica ser sorteada nem garante premio.
