# Déploiement — Sonic Paint

## TL;DR

```bash
./deploy.sh
```

Build l'image, la pousse, redémarre le conteneur sur la VM. ~5 min. L'app
est en ligne sur **https://sonicpaint.verso.fr**.

## Où ça tourne (important)

La prod n'est **PAS** sur Cloud Run. Elle tourne comme conteneur Docker sur
une **VM Compute Engine** :

| Élément | Valeur |
|---|---|
| Domaine | `sonicpaint.verso.fr` → IP `34.77.44.225` |
| VM | `penpot-server` (e2-standard-4, `europe-west1-b`) |
| Projet de la VM | `campaign-truth-prod` |
| Reverse-proxy + TLS | conteneur `penpot-caddy-1` (Caddy, certbot auto) — config `~/penpot/Caddyfile` |
| Conteneur app | `deluxe-paint` → `172.17.0.1:4503` → port 8080 interne |
| Image | `europe-west9-docker.pkg.dev/scan-to-bim-alignment-prod/cloud-run-source-deploy/deluxe-paint:latest` |
| Définition du service | `~/povchat/docker-compose.yml` (réseau `povchat_default`) |
| Secrets | Secret Manager via **berglas** (refs `sm://…`) |

La route Caddy :

```
sonicpaint.verso.fr {
    reverse_proxy 172.17.0.1:4503
    ...
}
```

## Les secrets (berglas)

L'image construite depuis `./Dockerfile` est **volontairement « nue »** (pas
de berglas dedans). Le compose de la VM :

```yaml
volumes:
  - /usr/local/bin/berglas:/usr/local/bin/berglas:ro   # binaire monté depuis l'hôte
entrypoint:
  - /usr/local/bin/berglas
  - exec
  - --
  - docker-entrypoint.sh
environment:
  DATABASE_URL: sm://scan-to-bim-alignment-prod/DELUXE_PAINT_DATABASE_URL
  BREVO_API_KEY: sm://scan-to-bim-alignment-prod/DELUXE_PAINT_BREVO_API_KEY
  MAIL_FROM_EMAIL: noreply@verso.fr
  MAIL_FROM_NAME: Sonic Paint
```

berglas résout les `sm://…` au démarrage avec le compte de service de la VM
(`472136847189-compute@developer.gserviceaccount.com`).

> ⚠️ **Ne jamais ajouter berglas au `Dockerfile`.** Le wrapping est fait par
> le compose. Un Dockerfile « nu » est correct.

Pour changer un secret : `gcloud secrets versions add DELUXE_PAINT_DATABASE_URL
--data-file=- --project scan-to-bim-alignment-prod` puis `./deploy.sh --restart`.

## Pipeline détaillé

1. **Build** — `gcloud builds submit --tag <image> .` lance Cloud Build sur le
   `Dockerfile` (le workspace pnpm ne se build pas en local sur Mac : les
   binaires natifs darwin sont exclus par les overrides — seul Cloud Build
   produit une vraie image). Pousse `:latest` dans Artifact Registry.
2. **Restart** — sur la VM : `cd ~/povchat && docker compose pull deluxe-paint
   && docker compose up -d deluxe-paint`. Recrée le conteneur avec la nouvelle
   image, berglas + secrets + routage Caddy intacts.
3. **TLS** — Caddy gère le certificat automatiquement, rien à faire.

## Vérifier / debugger

```bash
# l'app répond ?
curl -I https://sonicpaint.verso.fr/

# logs du conteneur
gcloud compute ssh penpot-server --project campaign-truth-prod --zone europe-west1-b \
  --tunnel-through-iap --command='sudo docker logs --tail 50 deluxe-paint'

# le tag :latest courant
gcloud artifacts docker tags list \
  europe-west9-docker.pkg.dev/scan-to-bim-alignment-prod/cloud-run-source-deploy/deluxe-paint
```

## Note

`git push` vers GitHub **ne déploie rien** (pas de CI auto). Le déploiement
est explicite via `./deploy.sh`. Le code et l'historique restent sur
`github.com/peopleofverso2/deluxe-paint`.
