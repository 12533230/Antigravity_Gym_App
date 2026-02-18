# TrainTrack — Controle de Treino e Progressão de Carga

Aplicativo web de controle de treino com análise comparativa, gráficos de evolução e sincronização com Google Sheets.

## Como usar

1. Abra o arquivo `index.html` diretamente no Chrome ou Edge
2. Clique em **Iniciar Novo Treino**
3. Preencha os exercícios e clique em **Próximo Exercício** para salvar e continuar
4. Acesse a aba **Performance** para ver seus gráficos de evolução

## Configurar Google Sheets (opcional)

### Passo 1 — Criar a planilha
1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma nova planilha

### Passo 2 — Criar o Apps Script
1. Na planilha, clique em **Extensões → Apps Script**
2. Apague o código existente e cole o código exibido na aba **Config** do app
3. Salve o projeto (Ctrl+S)

### Passo 3 — Publicar como Web App
1. Clique em **Implantar → Nova implantação**
2. Tipo: **App da Web**
3. Executar como: **Eu (sua conta)**
4. Quem tem acesso: **Qualquer pessoa**
5. Clique em **Implantar** e autorize as permissões
6. Copie a URL gerada

### Passo 4 — Configurar no app
1. Abra a aba **Config** no TrainTrack
2. Cole a URL no campo **URL do Web App**
3. Clique em **Salvar Configuração**
4. Clique em **Testar Conexão** para verificar

A partir daí, cada exercício registrado será automaticamente adicionado à sua planilha.

## Estrutura da planilha

| ID | Data | Exercício | Carga (kg) | Reps | Séries | Volume | Notas | Sessão |
|----|------|-----------|------------|------|--------|--------|-------|--------|

## Funcionalidades

- ✅ Auto-save local (localStorage)
- ✅ Autocomplete inteligente de exercícios
- ✅ Motor de insights (recordes e regressões)
- ✅ Gráficos de evolução por exercício (Chart.js)
- ✅ Histórico agrupado por sessão
- ✅ Exportação CSV
- ✅ Sincronização com Google Sheets
- ✅ Dark mode
