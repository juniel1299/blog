# ADR 0001: Cloudflare 서버리스로 운영

- 상태: 채택 (2026-10-16)

## 배경

처음 설계(Phase 0 명세)는 FastAPI + PostgreSQL/pgvector + Docker Compose였다.
운영자는 Docker를 계속 켜 둘 컴퓨터가 없고, 블로그 글은 75개 정도로 데이터가 작다.

## 결정

Cloudflare Workers(API, Cron) + D1(SQLite, FTS5) + Vectorize(벡터) + Workers AI(bge-m3 임베딩)로 운영한다. 언어는 JavaScript.

## 이유

- 상시 서버 없음. 무료 플랜 한도 안에서 충분 (월 비용 0원)
- FastAPI 대안은 무료 호스팅이면 잠들어서 첫 응답이 느리고, 상시 운영이면 서버+DB 비용이 든다
- 같은 계정 안에서 임베딩/벡터/DB가 해결돼 외부 API 키가 필요 없다

## 결과

- 무료 플랜 제약(실행당 CPU 10ms, 서브요청 50개)에 맞춰 수집을 쪼갰다 ([0003](0003-cron-ingestion-in-worker.md))
- Workers AI/Vectorize는 로컬에서 동작하지 않아 `wrangler dev --remote`나 배포본으로 확인한다
- Phase 0 명세의 FastAPI/Alembic/pgvector 부분은 쓰지 않았다
