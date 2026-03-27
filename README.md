# 💸 FinTrack — Controle Financeiro Pessoal

App React para controle de gastos, receitas e metas. Deploy no Vercel, dados salvos no GitHub.

---

## Setup em 5 passos

### 1. Cria dois repos no GitHub

- **`fintrack`** — código do app (este projeto)
- **`fintrack-data`** — onde os dados ficam salvos (pode ser privado)

No repo `fintrack-data`, faça commit do arquivo `data.json` com conteúdo:
```json
{"transactions": [], "goals": []}
```

### 2. Gera um GitHub Personal Access Token

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Clica em **Generate new token (classic)**
3. Seleciona o escopo `repo` (acesso completo a repositórios)
4. Gera e copia o token (começa com `ghp_`)

### 3. Configura a senha no código

Em `src/App.jsx`, linha com `PASSWORD`, troca o valor:
```js
PASSWORD: "minha_senha_secreta",
```

### 4. Deploy no Vercel

1. Importa o repo `fintrack` no [vercel.com](https://vercel.com)
2. Nas configurações do projeto → **Environment Variables**, adiciona:
   - `VITE_GITHUB_TOKEN` = `ghp_seuToken`
   - `VITE_GITHUB_OWNER` = `seu_usuario`
   - `VITE_GITHUB_REPO` = `fintrack-data`
3. Faz o deploy

### 5. Teste local (opcional)

```bash
cp .env.example .env.local
# edita .env.local com seus valores reais

npm install
npm run dev
```

---

## Como usar

- **Login**: entra com a senha que você configurou
- **Dashboard**: resumo do mês atual, gastos por categoria
- **Lançamentos**: adiciona receitas e gastos, filtra por mês/tipo
- **Metas**: cria metas de economia com barra de progresso

Os dados são salvos automaticamente no `data.json` do seu repo `fintrack-data` a cada alteração.

---

## Segurança

- A senha fica no código do Vercel (não visível publicamente se o repo for privado)
- O GitHub Token fica nas variáveis de ambiente do Vercel (nunca exposto no browser)
- Para uso pessoal, esse nível de segurança é mais que suficiente
