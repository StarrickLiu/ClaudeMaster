CONDA_ENV = claudemaster
PY = conda run --no-capture-output -n $(CONDA_ENV)

.PHONY: install dev dev-backend dev-frontend lint test test-backend test-frontend hooks

install:
	conda create -n $(CONDA_ENV) python=3.12 -y
	$(PY) pip install -r backend/requirements-dev.txt
	cd frontend && npm install
	$(MAKE) hooks

hooks:
	git config core.hooksPath .githooks

dev-backend:
	cd backend && $(PY) python -m uvicorn main:app --host $$(python -c "import os; print('0.0.0.0' if os.getenv('AUTH_TOKEN') else '127.0.0.1')") --port 8420 --reload

dev-frontend:
	cd frontend && npx vite --host

dev:
	$(MAKE) dev-backend &
	$(MAKE) dev-frontend

lint:
	$(PY) ruff check backend/
	cd frontend && npx eslint src/

test-backend:
	cd backend && $(PY) pytest -v

test-frontend:
	cd frontend && npx vitest run

test: test-backend test-frontend
