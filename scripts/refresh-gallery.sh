#!/usr/bin/env bash

set -euo pipefail

hook_url="${VERCEL_DEPLOY_HOOK_URL:-}"

if [[ -z "$hook_url" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Error: VERCEL_DEPLOY_HOOK_URL is not set." >&2
    exit 1
  fi

  read -r -s -p "Paste the Vercel Deploy Hook URL: " hook_url
  printf '\n'
fi

case "$hook_url" in
  https://api.vercel.com/v1/integrations/deploy/*) ;;
  *)
    echo "Error: this does not look like a Vercel Deploy Hook URL." >&2
    exit 1
    ;;
esac

echo "Triggering the gallery production deployment..."

response=""
if ! response=$(curl --silent --show-error --fail-with-body --request POST "$hook_url"); then
  echo "Failed to trigger the Vercel deployment." >&2
  if [[ -n "$response" ]]; then
    printf '%s\n' "$response" >&2
  fi
  exit 1
fi

DEPLOY_RESPONSE="$response" node <<'NODE'
const response = process.env.DEPLOY_RESPONSE || ''

try {
  const payload = JSON.parse(response)
  const job = payload.job

  if (!job?.id) {
    console.error('Vercel returned an unexpected response:')
    console.error(response)
    process.exit(1)
  }

  console.log('Gallery deployment triggered successfully.')
  console.log(`Job: ${job.id}`)
  console.log(`State: ${job.state || 'PENDING'}`)
  console.log('Open the Vercel Deployments page to follow the build progress.')
}
catch {
  console.error('Vercel returned a non-JSON response:')
  console.error(response)
  process.exit(1)
}
NODE
