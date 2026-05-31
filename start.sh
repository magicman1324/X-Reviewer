#!/usr/bin/env bash
set -e

echo "============================================"
echo "  X-Reviewer — AI Code Review Assistant"
echo "============================================"
echo ""

echo "[1/2] Installing dependencies..."
npm install

echo ""
echo "[2/2] Starting server..."
echo ""
echo "  Health check: http://localhost:3000/health"
echo "  Webhook:     http://localhost:3000/api/github/webhooks"
echo ""
echo "============================================"
echo ""

npm run dev
