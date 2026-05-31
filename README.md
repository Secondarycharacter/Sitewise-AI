# FAM — 건축규제 자동검색 시스템

## Phase 1
지번 입력 → 대지 생성 → 웹 3D 표시

## Phase 2
지번 입력 → **실제 필지 경계**(VWorld) → **용도지역·건폐율·용적률** 분석 → **건축가능 체적** 3D 표시

## Phase3: 규제 기반 3D 설계 편집 MVP
지번 입력 → **규제 분석** → **층별 그리드 평면 편집** → **3D 모델 반영** → **저장/불러오기**

자세한 개발 이력과 현재 Phase3 범위는 [`docs/development-phases.md`](docs/development-phases.md)를 참고하세요.

### 기능
- VWorld 주소/필지 API 연동
- 토지특성·토지이용계획 속성 조회
- 용도지역별 건폐율·용적률 자동 매칭 (국토계획법 시행령 별표 기준)
- 층별 평면 편집 및 3D 모델 반영

## 설정

프로젝트 루트에 `.env` 파일 생성:

```env
VWORLD_API_KEY=발급받은_인증키
VWORLD_DOMAIN=http://localhost:3000
```

API 키 없이 UI만 확인하려면:

```env
FAM_DEMO_MODE=true
```

## 실행

### Backend
```bash
cd apps/api
pip install -r requirements.txt
# .env는 프로젝트 루트(phase1_architecture_mvp)에 둡니다
uvicorn main:app --reload
```

### Frontend
```bash
cd apps/web
npm install
npm run dev
```

브라우저: http://localhost:3000

## API

`POST /generate`

```json
{ "address": "서울특별시 강남구 역삼동 737" }
```

응답: `modelUrl`, `parcel`, `regulations`
