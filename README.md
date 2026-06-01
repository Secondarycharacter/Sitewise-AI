# FAM — 규제 기반 3D 건축계획 MVP

지번 입력부터 실제 필지 경계, 건축규제 분석, 3D 매스/평면 편집, 주차 산정, 세움터식 건축개요 초안까지 연결하는 초기 건축계획 도구입니다.

자세한 개발 이력은 [`docs/development-phases.md`](docs/development-phases.md)를 참고하세요.

## 현재 범위

- VWorld/Juso 기반 주소, PNU, 실제 필지 경계 조회
- 용도지역, 건폐율, 용적률, 높이 제한 등 기본 규제 분석
- 법제처 Open API 기반 법/조례/별표 검색 및 로컬 문서 캐시
- `건축법 시행령 별표 1` 기반 건축물 용도 분류 초안
- 주차장 조례 별표 기반 부설주차장 산정 규칙 파싱 및 주차대수 후보 산정
- 주택, 오피스텔, 상가주택, 공동주택, 주상복합을 고려한 건축개요 데이터 모델
- 세움터/건축HUB 호환형 `buildingPermitOverview` 생성
- 세움터 UI를 참고한 건축개요 입력 화면
- 층별 3D 매스, 평면/그리드 편집, 모델 저장/불러오기
- 지구단위계획 문서 요약 기능 초안

## 주요 화면

- `분석`: 주소 입력 후 필지, 규제, 3D 매스, 법규 근거를 생성합니다.
- `모델 설정`: 층고, 지하층, 층별 용도, 공지선 등 모델링 기본값을 조정합니다.
- `설계 옵션`: 층별 footprint를 실시간으로 조정합니다.
- `건축개요`: 세움터 입력 UI를 참고해 대지조건, 전체개요, 동별개요, 층별개요, 주차장, 공적공간, 호/실/가구별 면적을 표시합니다.

## 실행 방법

백엔드:

```powershell
python -m pip install -r apps/api/requirements.txt
python -m uvicorn apps.api.main:app --reload --port 8002
```

프론트엔드:

```powershell
cd apps\web
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 환경변수

`.env.example`을 참고해 필요한 키를 설정합니다.

- `VWORLD_API_KEY`: 필지/토지특성 조회용
- `JUSO_API_KEY`: 주소 검색/정규화용
- `LAW_OC`: 법제처 Open API OC 값
- `LAW_API_PROTOCOL`: 법제처 API 호출 프로토콜, 환경에 따라 `http` 또는 `https`
- `LAW_REFERER`, `LAW_USER_AGENT`: 법제처 API 요청 헤더

`LAW_OC` 등 일부 값은 `.cursor/mcp.json`의 MCP 환경변수에서도 읽도록 구성되어 있습니다. 실제 키 파일은 커밋하지 않습니다.

## 검증 명령

Python 테스트:

```powershell
python -m unittest tests.test_building_permit_overview tests.test_building_program_model tests.test_parking_engine
python -m unittest tests.test_building_use_appendix_parser tests.test_law_openapi_client_config tests.test_law_reference_selection
```

법제처 API 연결 확인:

```powershell
python scripts/verify_law_api.py --address "서울특별시 중구 세종대로 110"
```

프론트 빌드:

```powershell
cd apps\web
npm exec next build
```

현재 Next.js 빌드 중 SWC lockfile patch 경고가 표시될 수 있지만, 빌드 자체는 정상 완료됩니다.

## 참고

- 세움터 화면은 직접 제출/접수 API가 아니라 입력 UX와 항목 구조를 참고했습니다.
- 내부 건축개요 스키마는 `국토교통부_건축HUB_건축인허가정보 서비스`의 기본개요, 동별개요, 층별개요, 호별개요, 주차장, 지역지구구역 구조를 기준으로 잡았습니다.
- 실제 세움터 제출용 export는 향후 별도 업로드 명세 확인 후 구현해야 합니다.

