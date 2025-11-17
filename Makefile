.PHONY: install backend frontend backend-build backend-run stack-up

DOCKER_IMAGE ?= lyric-backend

install:
	pip install -r requirements.txt

backend:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

backend-build:
	docker build -t $(DOCKER_IMAGE) .

backend-run:
	docker run --rm -p 8000:8000 $(DOCKER_IMAGE)

stack-up: backend-build backend-run

frontend:
	cd frontend && npm install && npm run dev -- --host 0.0.0.0 --port 3000
