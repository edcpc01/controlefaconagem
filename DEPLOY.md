# Como fazer deploy das atualizações

## Opção A — GitHub (recomendado, deploy automático)

```bash
cd faconagem-pwa
git init
git add .
git commit -m "fix: OpenRouter PDF extraction"
git remote add origin https://github.com/edcpc01/controlefaconagem.git
git push -u origin main --force
```
A Vercel detecta o push e faz deploy automático.

## Opção B — Vercel CLI (deploy direto sem GitHub)

```bash
npm install -g vercel
cd faconagem-pwa
vercel --prod
```
Na primeira vez, ele pergunta se quer linkar ao projeto existente — responda Sim e selecione `controlefaconagem`.

## Opção C — Re-importar ZIP na Vercel

1. Extraia o zip
2. Vercel Dashboard → seu projeto → Settings → Git → "Deploy from upload"
   OU: novo projeto → Import → Upload folder
