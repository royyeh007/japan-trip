# Makefile for lily-japan-trip (React + TypeScript + Vite)
#
#   make            -> install deps (if needed) and start the dev server
#   make start      -> same as above
#   make PORT=3000  -> start the dev server on another port
#   make build      -> type-check and build the production bundle into dist/
#   make preview    -> serve the production build locally
#   make lint       -> run eslint
#   make clean      -> remove dist/
#   make reset      -> remove dist/ and node_modules/

NPM  ?= npm
PORT ?= 5173

.DEFAULT_GOAL := start

.PHONY: start dev install build preview lint clean reset help

## Start the Vite dev server (installs dependencies first if missing)
start: node_modules
	$(NPM) run dev -- --port $(PORT)

dev: start

## Install dependencies
install: node_modules

# Re-run npm install only when package.json / package-lock.json change
node_modules: package.json package-lock.json
	$(NPM) install
	@touch node_modules

## Type-check and build for production
build: node_modules
	$(NPM) run build

## Serve the production build locally
preview: build
	$(NPM) run preview -- --port $(PORT)

## Run eslint
lint: node_modules
	$(NPM) run lint

## Remove build output
clean:
	rm -rf dist

## Remove build output and installed dependencies
reset: clean
	rm -rf node_modules

## Show this help
help:
	@echo "Usage: make [target] [PORT=5173]"
	@echo ""
	@echo "Targets:"
	@echo "  start (default)  install deps if needed, then start the dev server"
	@echo "  install          npm install"
	@echo "  build            tsc -b && vite build  -> dist/"
	@echo "  preview          serve dist/ locally"
	@echo "  lint             eslint ."
	@echo "  clean            remove dist/"
	@echo "  reset            remove dist/ and node_modules/"
	@echo ""
	@echo "Supabase:"
	@echo "  link REF=<ref>   link to your Supabase project"
	@echo "  db-push          create tables, policies, buckets"
	@echo "  fn-deploy        deploy Edge Functions (parse-upload, chat)"
	@echo "  secrets ANTHROPIC_API_KEY=...  store the Claude key"
	@echo "  seed             push seed/trip.ts into the database"
	@echo "  usage [N=15]     what the AI chat cost, per day and for the last N replies"
	@echo "  setup            db-push + fn-deploy + seed"

# ---------- Supabase ----------
REF ?=

## Push local seed/trip.ts (families, days, todo, contacts, form, admin, invite) into Supabase
seed: node_modules
	node seed/seed.mjs

## Show what the AI chat cost (per day, and the last N replies): make usage N=30
N ?= 15
usage: node_modules
	node seed/usage.mjs $(N)

## Link this folder to your Supabase project: make link REF=<project-ref>
link:
	supabase link --project-ref $(REF)

## Create the tables / policies / buckets in the linked project
db-push:
	supabase db push

## Deploy both Edge Functions
fn-deploy:
	supabase functions deploy parse-upload --no-verify-jwt
	supabase functions deploy chat --no-verify-jwt

## Store the Claude API key for the Edge Functions: make secrets ANTHROPIC_API_KEY=sk-ant-...
secrets:
	supabase secrets set ANTHROPIC_API_KEY=$(ANTHROPIC_API_KEY)

## Everything after `make link`: tables, functions, data
setup: db-push fn-deploy seed

.PHONY: seed link db-push fn-deploy secrets setup

## Push auth settings incl. Google login (needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.local)
auth-push:
	@set -a; . ./.env.local; set +a; supabase config push --yes

.PHONY: auth-push
