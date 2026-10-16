# ADR 0007: Worker는 main 머지 시 자동 배포, 스킨은 수동

- 상태: 채택 (2026-10-16)

## 결정

- GitHub Actions `deploy` 잡: `main` push + 검사 통과 → 원격 D1 마이그레이션 → doc_links seed → `wrangler deploy` → `/health/ready` 확인
- Cloudflare 토큰은 저장소 시크릿(`BLOG`)으로만 주입, 계정 ID는 `FLARE`. 토큰 권한은 최소(Workers Scripts, D1, Vectorize Edit, Account Settings Read)
- 스킨은 자동화하지 않는다 (티스토리 업로드 API 없음)

## 결과

- 머지 후 약 40초 안에 배포된다
- 저장소가 public이라 비밀값을 파일에 쓰면 이력에 남는다 → 실제로 한 번 발생, 값 폐기 후 시크릿으로 전환 ([security.md](../security.md))
- 스킨 변경이 있는 PR은 머지 후 [skin.md](../skin.md#배포-수동) 절차로 반영해야 한다
