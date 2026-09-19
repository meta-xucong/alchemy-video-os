set -euo pipefail
cd /opt/alchemy-video
compose=(sudo docker-compose --env-file /opt/alchemy-video/secrets/video.env -f infrastructure/deploy/docker-compose.video.yml)
"${compose[@]}" build production-worker
"${compose[@]}" up -d --no-deps --force-recreate production-worker
sleep 3
echo 'production-worker-status:'
sudo docker ps --filter name=deploy_production-worker_1 --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.CreatedAt}}'
echo 'production-worker-fixed-billing-symbol:'
sudo docker exec deploy_production-worker_1 sh -c 'grep -R -l fixed_billing_policy /app/packages/persistence/dist /app/apps/production-worker/dist 2>/dev/null | head -n 20 || true'
echo 'production-worker-ready-log:'
sudo docker logs --since 30s deploy_production-worker_1 2>&1 | tail -n 40
