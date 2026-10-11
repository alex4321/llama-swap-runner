#!/usr/bin/env bash
set -euo pipefail
ENDPOINT="${1:-http://127.0.0.1:8082/v1/systemone}"
HEADERS=(-H 'Content-Type: application/json')
if [ -n "${JEV_API_KEY:-}" ]; then
    HEADERS+=(-H "Authorization: Bearer $JEV_API_KEY")
fi
curl --fail-with-body --silent --show-error --max-time 190 \
    --write-out '\nHTTP %{http_code}; total %{time_total}s\n' \
    "$ENDPOINT" "${HEADERS[@]}" --data-binary @- <<'JSON'
{
  "model": "jev-latest",
  "state": "The customer says: I was charged twice for my subscription this month. Please refund the duplicate payment.",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this request?",
      "criteria": {
        "billing": "Payments, invoices, refunds, or subscription charges",
        "technical": "Software bugs or integration failures",
        "sales": "Pricing questions or purchasing a new subscription"
      }
    },
    "billing_issue": { "type": "noul", "instructions": "Is this a billing issue?" }
  }
}
JSON
