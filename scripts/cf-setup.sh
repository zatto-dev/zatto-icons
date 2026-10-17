#!/usr/bin/env bash
# One-time Cloudflare Pages + GitHub secrets setup for Zatto Icons. Idempotent.
# Run where `zsecret` and `gh` work (CT111). Secret values stay in variables / pipes and are never printed.
#
# Needs Vault key infra/cloudflare/CF_PAGES_TOKEN: an API token with  Account > Cloudflare Pages > Edit
# (the existing CF_DNS_TOKEN only has DNS edit + zone read and CLOUDFLARE_API_TOKEN is invalid).
set -euo pipefail

REPO=zatto-dev/zatto-icons
PROJECT=zatto-icons
DOMAIN=icons.zatto.dev
ZONE=zatto.dev
CF=https://api.cloudflare.com/client/v4

ACCOUNT=$(zsecret infra/cloudflare/CLOUDFLARE_ACCOUNT_ID)
PAGES_TOKEN=$(zsecret infra/cloudflare/CF_PAGES_TOKEN)
DNS_TOKEN=$(zsecret infra/cloudflare/CF_DNS_TOKEN)

api() { local tok=$1; shift; curl -sS -H "Authorization: Bearer $tok" -H "Content-Type: application/json" "$@"; }
ok() { jq -e '.success == true' >/dev/null; }

echo "1/5 verify Pages token"
api "$PAGES_TOKEN" "$CF/accounts/$ACCOUNT/pages/projects?per_page=1" | ok || { echo "Pages token cannot list projects (needs Account > Cloudflare Pages > Edit)"; exit 1; }

echo "2/5 Pages project"
if api "$PAGES_TOKEN" "$CF/accounts/$ACCOUNT/pages/projects/$PROJECT" | ok; then echo "  exists"; else
  api "$PAGES_TOKEN" -X POST "$CF/accounts/$ACCOUNT/pages/projects" \
    -d "{\"name\":\"$PROJECT\",\"production_branch\":\"main\"}" | ok && echo "  created"
fi

echo "3/5 custom domain $DOMAIN"
if api "$PAGES_TOKEN" "$CF/accounts/$ACCOUNT/pages/projects/$PROJECT/domains/$DOMAIN" | ok; then echo "  attached"; else
  api "$PAGES_TOKEN" -X POST "$CF/accounts/$ACCOUNT/pages/projects/$PROJECT/domains" -d "{\"name\":\"$DOMAIN\"}" | ok && echo "  attached"
fi

echo "4/5 DNS CNAME $DOMAIN -> $PROJECT.pages.dev (proxied)"
ZONE_ID=$(api "$DNS_TOKEN" "$CF/zones?name=$ZONE" | jq -r '.result[0].id')
REC=$(api "$DNS_TOKEN" "$CF/zones/$ZONE_ID/dns_records?name=$DOMAIN" | jq -r '.result[0].id // empty')
BODY="{\"type\":\"CNAME\",\"name\":\"icons\",\"content\":\"$PROJECT.pages.dev\",\"proxied\":true,\"ttl\":1}"
if [ -n "$REC" ]; then api "$DNS_TOKEN" -X PUT "$CF/zones/$ZONE_ID/dns_records/$REC" -d "$BODY" | ok && echo "  updated"
else api "$DNS_TOKEN" -X POST "$CF/zones/$ZONE_ID/dns_records" -d "$BODY" | ok && echo "  created"; fi

echo "5/5 GitHub secrets for $REPO"
printf '%s' "$PAGES_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN -R "$REPO"
printf '%s' "$ACCOUNT" | gh secret set CLOUDFLARE_ACCOUNT_ID -R "$REPO"

echo "done. Deploy: gh workflow run build-and-deploy -R $REPO"
