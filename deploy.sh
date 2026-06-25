#!/usr/bin/env bash
#
# deploy.sh — ship the current repo to https://sonicpaint.verso.fr
#
# Production runs as a Docker container on the `penpot-server` VM, NOT on
# Cloud Run. The flow:
#
#   this script  ->  Cloud Build (builds ./Dockerfile, pushes :latest to
#                    Artifact Registry)  ->  VM: docker compose pull + up
#                    ->  Caddy (auto-TLS) serves sonicpaint.verso.fr
#
# Secrets are NOT baked into the image. The povchat compose file on the VM
# mounts the berglas binary and overrides the entrypoint to
# `berglas exec -- …`, which resolves the `sm://…` env refs (DATABASE_URL,
# BREVO_API_KEY) from Secret Manager at container start, using the VM's
# service account. So the image built from ./Dockerfile is plain and
# correct — do not add berglas to the Dockerfile.
#
# Usage:
#   ./deploy.sh            # build + push + restart on the VM
#   ./deploy.sh --restart  # skip the build, just pull :latest + restart
#
set -euo pipefail

IMG="europe-west9-docker.pkg.dev/scan-to-bim-alignment-prod/cloud-run-source-deploy/deluxe-paint:latest"
BUILD_PROJECT="scan-to-bim-alignment-prod"
VM="penpot-server"
VM_PROJECT="campaign-truth-prod"
VM_ZONE="europe-west1-b"
COMPOSE_DIR="~/povchat"          # the compose file that defines the deluxe-paint service
COMPOSE_SVC="deluxe-paint"
URL="https://sonicpaint.verso.fr/"

cd "$(dirname "$0")"

if [[ "${1:-}" != "--restart" ]]; then
  echo "==> Building + pushing image via Cloud Build (≈5 min)…"
  gcloud builds submit --tag "$IMG" --project "$BUILD_PROJECT" .
else
  echo "==> Skipping build (--restart): will pull the existing :latest."
fi

echo "==> Pulling + restarting the container on $VM…"
gcloud compute ssh "$VM" --project "$VM_PROJECT" --zone "$VM_ZONE" --tunnel-through-iap \
  --command="cd $COMPOSE_DIR && sudo docker compose pull $COMPOSE_SVC && sudo docker compose up -d $COMPOSE_SVC && sudo docker image prune -f >/dev/null 2>&1 || true"

echo "==> Verifying…"
sleep 3
code=$(curl -sS -o /dev/null -w "%{http_code}" "$URL" || echo "000")
echo "    $URL -> HTTP $code"
[[ "$code" == "200" ]] && echo "✓ Live." || echo "⚠ Unexpected status — check 'docker logs deluxe-paint' on the VM."
